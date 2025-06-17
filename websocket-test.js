import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// 커스텀 메트릭 정의
const messageRate = new Rate('message_rate');
const errorRate = new Rate('error_rate');

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // 30초 동안 50명의 사용자로 증가
    { duration: '1m', target: 50 },   // 1분 동안 50명의 사용자 유지
    { duration: '30s', target: 0 },   // 30초 동안 사용자 수 감소
  ],
  thresholds: {
    'message_rate': ['rate>0.95'],    // 95% 이상의 메시지가 성공적으로 전송되어야 함
    'error_rate': ['rate<0.05'],      // 5% 미만의 에러율
  },
};

export default function () {
  const url = 'ws://localhost:8081/ws';
  const headers = {
    'Authorization': 'Bearer test-token'
  };

  const res = ws.connect(url, { headers }, function (socket) {
    socket.on('open', function () {
      console.log('WebSocket 연결 성공');

      // STOMP CONNECT 프레임
      const connectFrame = 'CONNECT\naccept-version:1.2\nheart-beat:0,0\n\n\0';
      socket.send(connectFrame);
      sleep(1);

      // STOMP SUBSCRIBE 프레임
      const subscribeFrame = 'SUBSCRIBE\nid:sub-0\ndestination:/exchange/chat.exchange/chat.channel.1\n\n\0';
      socket.send(subscribeFrame);
      sleep(1);

      // 메시지 전송
      for (let i = 0; i < 10; i++) {
        const sendFrame = `SEND\ndestination:/pub/chat.message.1\ncontent-type:text/plain\n\n테스트 메시지 ${i}\0`;
        socket.send(sendFrame);
        messageRate.add(1);
        sleep(1);
      }

      socket.setTimeout(function () {
        // STOMP DISCONNECT 프레임
        const disconnectFrame = 'DISCONNECT\n\n\0';
        socket.send(disconnectFrame);
        socket.close();
      }, 30000);
    });

    socket.on('message', function (data) {
      console.log('서버로부터 메시지 수신:', data);
      check(data, {
        '메시지 수신 성공': (d) => d !== null,
      });
    });

    socket.on('close', function () {
      console.log('연결 종료됨');
    });

    socket.on('error', function (e) {
      console.log('에러:', e.error());
      errorRate.add(1);
    });
  });

  check(res, { 
    '연결 성공': (r) => r && r.status === 101
  });
}
