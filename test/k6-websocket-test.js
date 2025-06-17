import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// 📊 커스텀 메트릭
const connectionSuccessRate = new Rate('ws_connection_success');
const messageSuccessRate = new Rate('ws_message_success');
const messageLatency = new Trend('ws_message_latency');

// 🚀 부하 설정
export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '2m', target: 10 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    'ws_connection_success': ['rate>0.95'],
    'ws_message_success': ['rate>0.95'],
    'ws_message_latency': ['p(95)<500'],
  },
};

// ⚙️ 테스트 설정
const JWT = 'Bearer YOUR_VALID_JWT_HERE';
const CHANNEL_ID = 'test-channel';

// 🧱 STOMP 프레임 생성기
const STOMP_FRAME = {
  CONNECT: `CONNECT
accept-version:1.1
heart-beat:0,0
Authorization:${JWT}

\0`,

  SUBSCRIBE: `SUBSCRIBE
id:sub-0
destination:/exchange/chat.exchange/chat.channel.${CHANNEL_ID}

\0`,

  SEND: (message) => `SEND
destination:/pub/chat.message.${CHANNEL_ID}
content-type:application/json
Authorization:${JWT}

${JSON.stringify({
  serverId: "test-server",
  email: "test@example.com",
  writer: "test-user",
  content: message,
  messageType: "TALK",
  fileUrl: null,
  fileName: null
})}\0`,
};

// 🧪 k6 테스트 시나리오
export default function () {
  const url = 'ws://localhost:8081/ws';

  const res = ws.connect(url, (socket) => {
    socket.on('open', () => {
      console.log('🔗 WebSocket 연결 시도');
      connectionSuccessRate.add(1);
      socket.send(STOMP_FRAME.CONNECT);
      console.log('📨 CONNECT 프레임 전송');
    });

    socket.on('message', (data) => {
      console.log('📩 수신:', data);

      // 1️⃣ CONNECTED 프레임 수신 → 구독 시작 + 전송 시작
      if (data.includes('CONNECTED')) {
        console.log('✅ STOMP 연결 성공');
        socket.send(STOMP_FRAME.SUBSCRIBE);
        console.log('📨 SUBSCRIBE 프레임 전송');

        // 주기적 메시지 전송 시작
        const sendMessage = () => {
          const start = Date.now();
          const payload = STOMP_FRAME.SEND('부하 테스트 메시지');
          socket.send(payload);
          messageLatency.add(Date.now() - start);
          console.log(`📤 메시지 전송`);
        };

        sendMessage();
        const interval = setInterval(sendMessage, Math.random() * 2000 + 1000); // 1~3초 간격

        setTimeout(() => {
          clearInterval(interval);
          socket.close();
        }, 30000);
      }

      // 2️⃣ 서버로부터 수신된 MESSAGE → 메시지 성공 처리
      if (data.includes('MESSAGE') && data.includes(`/chat.channel.${CHANNEL_ID}`)) {
        messageSuccessRate.add(1);
        console.log('✅ 메시지 수신 성공');
      }

      // 3️⃣ 에러 처리
      if (data.includes('ERROR')) {
        connectionSuccessRate.add(0);
        messageSuccessRate.add(0);
        console.error('❌ STOMP ERROR:', data);
        socket.close();
      }
    });

    socket.on('error', (e) => {
      console.error('❗ WebSocket 에러:', e);
      connectionSuccessRate.add(0);
      messageSuccessRate.add(0);
    });

    socket.on('close', () => {
      console.log('🔌 WebSocket 연결 종료');
    });
  });

  check(res, { '✅ 연결 성공': (r) => r && r.status === 101 });
  sleep(1);
}
