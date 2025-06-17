import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// 📊 메트릭
const connectionSuccessRate = new Rate('ws_connection_success');
const messageSuccessRate = new Rate('ws_message_success');
const messageLatency = new Trend('ws_message_latency');

// 🧪 테스트 설정
export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    'ws_connection_success': ['rate>0.95'],
    'ws_message_success': ['rate>0.95'],
    'ws_message_latency': ['p(95)<1000'],
  },
};

// 🧬 테스트 대상
const JWT = 'Bearer test-token';
const CHANNEL_ID = 'test-channel-1';
const TEST_MESSAGE = 'Hello, WebSocket!';

export default function () {
  const url = 'ws://localhost:8081/ws';
  let messageSent = false;
  let messageReceived = false;

  const res = ws.connect(url, (socket) => {
    socket.on('open', () => {
      console.log('🔗 WebSocket 연결됨');
      connectionSuccessRate.add(1);

      // STOMP CONNECT 프레임
      const connectFrame = `CONNECT\naccept-version:1.1\nheart-beat:0,0\nAuthorization:${JWT}\n\n\0`;
      console.log('📤 CONNECT 프레임 전송');
      socket.send(connectFrame);
    });

    socket.on('message', (data) => {
      console.log('📥 수신:', data);

      // CONNECTED 프레임 수신 시 구독 시작
      if (data.includes('CONNECTED')) {
        console.log('✅ STOMP 연결 성공');
        
        // SUBSCRIBE 프레임
        const subscribeFrame = `SUBSCRIBE\nid:sub-0\ndestination:/topic/chat.channel.${CHANNEL_ID}\n\n\0`;
        console.log('📤 SUBSCRIBE 프레임 전송');
        socket.send(subscribeFrame);

        // k6에서는 setTimeout 대신 sleep 사용
        sleep(1); // 1초 대기

        // 바로 SEND 프레임 전송
        const messageBody = JSON.stringify({
          serverId: "test-server",
          email: "test@example.com",
          writer: "test-user",
          content: TEST_MESSAGE,
          messageType: "TALK",
          fileUrl: null,
          fileName: null
        });
        const sendFrame =
          `SEND\n` +
          `destination:/pub/chat.message.${CHANNEL_ID}\n` +
          `content-type:application/json\n` +
          `Authorization:${JWT}\n` +
          `\n` +
          `${messageBody}\0`;
        console.log('📤 SEND 프레임 전송 (raw):', JSON.stringify(sendFrame));
        socket.send(sendFrame);
        messageSent = true;
      }

      // MESSAGE 프레임 수신 처리
      if (data.includes('MESSAGE')) {
        console.log('📨 MESSAGE 프레임 수신');
        try {
          // 바디 추출 (헤더와 바디는 \n\n으로 구분, 바디 끝에 \0이 붙을 수 있음)
          const messageContent = data.split('\n\n')[1].replace(/\0$/, '').trim();
          const messageJson = JSON.parse(messageContent);
          
          if (messageJson.content === TEST_MESSAGE) {
            messageSuccessRate.add(1);
            messageReceived = true;
            console.log('✅ 메시지 수신 성공');
            // 연결 종료
            const disconnectFrame = 'DISCONNECT\n\n\0';
            console.log('📤 DISCONNECT 프레임 전송');
            socket.send(disconnectFrame);
            socket.close();
          }
        } catch (e) {
          console.error('❌ 메시지 파싱 실패:', e, data);
        }
      }

      // ERROR 프레임 처리
      if (data.includes('ERROR')) {
        console.error('❌ STOMP ERROR:', data);
        connectionSuccessRate.add(0);
        messageSuccessRate.add(0);
        socket.close();
      }
    });

    socket.on('close', () => {
      if (!messageReceived && messageSent) {
        messageSuccessRate.add(0);
        console.log('❌ 메시지 수신 실패');
      }
      console.log('🔌 연결 종료');
    });

    socket.on('error', (e) => {
      console.error('❗ 연결 실패:', e);
      connectionSuccessRate.add(0);
      messageSuccessRate.add(0);
    });
  });

  check(res, { '연결 성공': (r) => r && r.status === 101 });
  sleep(5);
} 