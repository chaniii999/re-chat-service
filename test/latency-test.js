import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

/*
[시나리오 요약]

1. 목적: 낮은 동접(50명) 환경에서 WebSocket 메시지의 지연시간(latency) 측정
2. 시나리오 흐름:
   - 50명의 가상 사용자가 1분 동안 지속적으로 연결 및 메시지 송수신 반복
   - 각 VU는 랜덤 채널에 접속 후, 메시지 전송 및 수신까지의 지연시간을 측정
   - 메시지 전송 성공률, 연결 성공률, 에러 카운트 등도 함께 측정
3. 주요 지표:
   - ws_connection_success: 연결 성공률 (목표 99% 이상)
   - ws_message_success: 메시지 송수신 성공률 (목표 99% 이상)
   - ws_message_latency: 메시지 왕복 지연시간 (목표 p95 < 1초)
   - error_count: 에러 발생 건수 (목표 10건 미만)
*/

// 📊 메트릭
const connectionSuccessRate = new Rate('ws_connection_success');
const messageSuccessRate = new Rate('ws_message_success');
const messageLatency = new Trend('ws_message_latency');
const errorCount = new Counter('error_count');

// 🧪 부하 설정 (낮은 지연 측정 목적)
export const options = {
  scenarios: {
    latency_test: {
      executor: 'constant-vus',
      vus: 100,
      duration: '1m',
    }
  },
  thresholds: {
    'ws_connection_success': ['rate>0.99'],
    'ws_message_success': ['rate>0.99'],
    'ws_message_latency': ['p(95)<1000'], // 목표: p95 < 1초
    'error_count': ['count<10']
  },
};

// 🧬 테스트 대상
const JWT = 'Bearer test-token';
const CHANNELS = ['channel-1', 'channel-2', 'channel-3'];

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function () {
  const channelId = random(CHANNELS);
  const url = 'ws://localhost:8081/ws';
  const messageBody = {
    serverId: "test-server",
    email: `latency-${__VU}@example.com`,
    writer: `test-user-${__VU}`,
    content: `지연 측정 테스트 메시지 - ${Date.now()}`,
    messageType: "TALK",
    fileUrl: null,
    fileName: null
  };

  let startTime = 0;
  let messageSent = false;
  let messageReceived = false;

  const res = ws.connect(url, (socket) => {
    socket.on('open', () => {
      connectionSuccessRate.add(1);
      const connectFrame = `CONNECT\naccept-version:1.1\nheart-beat:0,0\nAuthorization:${JWT}\n\n\0`;
      socket.send(connectFrame);
    });

    socket.on('message', (data) => {
      if (data.includes('CONNECTED')) {
        const subscribeFrame = `SUBSCRIBE\nid:sub-0\ndestination:/topic/chat.channel.${channelId}\n\n\0`;
        socket.send(subscribeFrame);

        sleep(0.5); // 구독 안정화 후 전송
        startTime = Date.now();

        const sendFrame =
          `SEND\n` +
          `destination:/pub/chat.message.${channelId}\n` +
          `content-type:application/json\n` +
          `Authorization:${JWT}\n\n` +
          `${JSON.stringify(messageBody)}\0`;

        socket.send(sendFrame);
        messageSent = true;
      }

      if (data.includes('MESSAGE')) {
        try {
          const body = data.split('\n\n')[1].replace(/\0$/, '');
          const received = JSON.parse(body);
          if (received.content === messageBody.content) {
            messageReceived = true;
            messageSuccessRate.add(1);
            messageLatency.add(Date.now() - startTime);
            const disconnectFrame = 'DISCONNECT\n\n\0';
            socket.send(disconnectFrame);
            socket.close();
          }
        } catch (err) {
          errorCount.add(1);
        }
      }

      if (data.includes('ERROR')) {
        errorCount.add(1);
        socket.close();
      }
    });

    socket.on('close', () => {
      if (!messageReceived && messageSent) {
        messageSuccessRate.add(0);
        errorCount.add(1);
      }
    });

    socket.on('error', (e) => {
      errorCount.add(1);
      connectionSuccessRate.add(0);
      messageSuccessRate.add(0);
    });
  });

  check(res, { '연결 성공': (r) => r && r.status === 101 });
  sleep(0.5); // 짧은 연결 유지
}
