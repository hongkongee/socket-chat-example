import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { availableParallelism } from 'node:os';
import cluster from 'node:cluster';
import { createAdapter, setupPrimary } from '@socket.io/cluster-adapter';

// 클러스터를 사용하여 여러 CPU 코어에서 소켓 서버를 실행
if (cluster.isPrimary) { // 현재 프로세스가 클러스터의 마스터 프로세스인 경우
  const numCPUs = availableParallelism();
  // 이용 가능한 코어당 한 worker을 생성
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork({
      PORT: 3000 + i
    });
  }

  // 주 프로세스 설정
  setupPrimary();

} else {

    // DB 파일 열기
  const db = await open({
    filename: 'chat.db',
    driver: sqlite3.Database
  });

  // create our 'messages' table (you can ignore the 'client_offset' column for now)
  await db.exec(
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_offset TEXT UNIQUE,
      content TEXT
  );`
  );


  // 워커 프로세스 설정
  const app = express();
  const server = createServer(app);
  const io = new Server(server, { // socket.io의 새 인스턴스 초기화
    // 클라이언트가 연결이 일시적으로 끊겨도 다시 연결했을 때 채팅 내용을 복구
    connectionStateRecovery: {},
    adapter: createAdapter()
  });

  const __dirname = dirname(fileURLToPath(import.meta.url));

  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
  });

  // 클라이언트 연결 이벤트 처리
  io.on('connection', async (socket) => {
      // 사용자가 연결되었을 때 한 번 실행
      console.log('A user connected');
      io.emit('firstConnect', {message : '*connected*'}); // 유저 입장 메세지 -> 모두에게 보이는 메세지
      // socket.broadcast.emit('firstConnect', {message : 'Welcome to the chat!'}); -> 본인 빼고 보이는 메세지
      // socket.emit('firstConnect', {message : 'Welcome to the chat!'}); -> 자기 자신만 보이는 메세지

      // 메시지 수신 이벤트
      socket.on('chat message', async (msg, clientOffset, id, callback) => {

          let result;
          try {
              // 메세지를 받을 때마다 DB에 메세지 insert
              console.log(`In server, ${clientOffset} stores message ${msg} into DB`);
              result = await db.run('INSERT INTO messages (content, client_offset) VALUES (?, ?)', msg, clientOffset);
          } catch (e) {
              if (e.errno === 19 /* SQLITE_CONSTRINT*/) { // SQLite의 특정 오류
                // 메세지가 이미 insert되어있으면 클라이언트에게 알린다.
                callback();
              } else {
                // nothing to do, just let the client retry
              }
              return;
          }

      
        // console.log('server gets message: ' + msg);
        io.emit('chat message', msg, result.lastID, id); // 모든 클라이언트에 메세지 전송
        callback();
      });

      if (!socket.recovered) {
          // 소켓 연결 상태 복구가 성공하지 못한 경우 -> DB에서 이전에 저장된 메세지 가져오기
          try {
              console.log('소켓 연결 상태 복구 실패! DB에서 메세지 가져오기!');
            await db.each('SELECT id, content FROM messages WHERE id > ?',
            // serverOffset : 클라이언트가 마지막으로 수신한 메세지의 ID 
            // -> 채팅방에 재연결이 될 때, 마지막으로 수신한 메세지 이후의 메세지를 select
              [socket.handshake.auth.serverOffset || 0], 
              (_err, row) => { // _err : 쿼리 실행 중 발생한 오류, row : 쿼리 결과의 각 행
                socket.emit('chat message', row.content, row.id); // select문을 각각 클라이언트에게 전송
              }
            )
          } catch (e) {
              console.log('db 에러');
          }
      }

      // 사용자 연결이 끊어졌을 때
      socket.on('disconnect', () => {
          console.log('A user disconnected');
          socket.broadcast.emit('userDisconnected', { message: '*disconnected*' });
      })
  });

  // each worker will listen on a distinct port
  const port = process.env.PORT;

  server.listen(port, () => {
    console.log(`server running at http://localhost:${port}`);
  });
}





