import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// 📊 메트릭
const connectionSuccessRate = new Rate('ws_connection_success');
const messageSuccessRate = new Rate('ws_message_success');
const messageLatency = new Trend('ws_message_latency');

// 🧪 부하 옵션
export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    'ws_connection_success': ['rate>0.95'],
    'ws_message_success': ['rate>0.95'],
    'ws_message_latency': ['p(95)<1000'],
  },
};

// 🧬 테스트 대상
const JWT = 'Bearer YOUR_VALID_JWT_HERE';
const CHANNELS = ['channel-1', 'channel-2', 'channel-3', 'channel-4', 'channel-5'];
const MESSAGES = [
  '5fEHXeUTPvcRi4KsQegy',
  'BwsgoerKnKwSssYQOK2q',
  'GrqlWk07Ns2oL4TegScH',
  'xz0YIa18kE7OC4isR2my',
  'FvCwezt18V73D9BR5j6p',
  'lI5XfAvL3He3kIS9RpOh',
  'szLUP7xJGo4aXWjliq1c',
  '7kUoeMFlO2qLabZaCi1s',
  '88a1yW1h3zsK1bcPcj9G',
  'RGUOsxDJNjtkkcawE5XD'
];

const random = (arr) => arr[Math.floor(Math.random() * arr.length)];

export default function () {
  const channelId = random(CHANNELS);
  const messageText = random(MESSAGES);
  const url = 'ws://localhost:8081/ws';

  const res = ws.connect(url, (socket) => {
    socket.on('open', () => {
      console.log(`🔗 연결됨 → ${channelId}`);
      connectionSuccessRate.add(1);
      socket.send(`CONNECT
accept-version:1.1
heart-beat:0,0
Authorization:${JWT}

\0`);
    });

    socket.on('message', (data) => {
      console.log('📩 수신:', data);

      if (data.includes('CONNECTED')) {
        socket.send(`SUBSCRIBE
id:sub-0
destination:/exchange/chat.exchange/chat.channel.${channelId}

\0`);

        // 전송 로직
        const sendMessage = () => {
          const start = Date.now();
          const payload = `SEND
destination:/pub/chat.message.${channelId}
content-type:application/json
Authorization:${JWT}

${JSON.stringify({
            serverId: "test-server",
            email: "test@example.com",
            writer: "test-user",
            content: messageText,
            messageType: "TALK",
            fileUrl: null,
            fileName: null
          })}\0`;

          socket.send(payload);
          messageLatency.add(Date.now() - start);
          console.log(`📤 전송 (${channelId}): ${messageText}`);
        };

        sendMessage();
        const interval = setInterval(sendMessage, Math.random() * 2000 + 1000);
        setTimeout(() => {
          clearInterval(interval);
          socket.close();
        }, 30000);
      }

      if (data.includes('MESSAGE') && data.includes(channelId)) {
        messageSuccessRate.add(1);
        console.log('✅ 수신 성공');
      }

      if (data.includes('ERROR')) {
        connectionSuccessRate.add(0);
        messageSuccessRate.add(0);
        console.error('❌ 에러:', data);
        socket.close();
      }
    });

    socket.on('close', () => {
      console.log('🔌 연결 종료');
    });

    socket.on('error', (e) => {
      console.error('❗ 연결 실패:', e);
      connectionSuccessRate.add(0);
      messageSuccessRate.add(0);
    });
  });

  check(res, { '✅ 연결 성공': (r) => r && r.status === 101 });
  sleep(1);
}
