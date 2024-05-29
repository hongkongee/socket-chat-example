import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';

const app = express();
const server = createServer(app);
const io = new Server(server, { // socket.io의 새 인스턴스 초기화
    // 클라이언트가 연결이 일시적으로 끊겨도 다시 연결했을 때 채팅 내용을 복구
    connectionStateRecovery: {} 
}); 

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

// 클라이언트 연결 이벤트 처리
io.on('connection', (socket) => {
    // 사용자가 연결되었을 때 한 번 실행
    console.log('A user connected');
    io.emit('firstConnect', {message : '*connected*'}); // 유저 입장 메세지 -> 모두에게 보이는 메세지
    // socket.broadcast.emit('firstConnect', {message : 'Welcome to the chat!'}); -> 본인 빼고 보이는 메세지
    // socket.emit('firstConnect', {message : 'Welcome to the chat!'}); -> 자기 자신만 보이는 메세지

    // 메시지 수신 이벤트
    socket.on('chat message', (msg) => {
      console.log('server gets message: ' + msg);
      io.emit('chat message', msg); // 모든 클라이언트에 메세지 전송
    });

    // 사용자 연결이 끊어졌을 때
    socket.on('disconnect', () => {
        console.log('A user disconnected');
        socket.broadcast.emit('userDisconnected', { message: '*disconnected*' });
    })
});



// 서버 실행
server.listen(3000, () => {
  console.log('server running at http://localhost:3000');
});