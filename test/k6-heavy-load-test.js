/*
[시나리오 요약]

1. Ramp-up (점진적 증가):
   - 2분 동안 VU(가상 사용자)를 200명까지 점진적으로 증가
   - 10명씩 20단계로 증가

2. Steady-state (유지):
   - 3분 동안 200명의 VU가 지속적으로 메시지를 송수신
   - 서버의 장기 안정성 확인

3. Spike (급격한 증가):
   - 1분 동안 300명의 VU가 동시에 접속
   - 서버의 한계 상황 테스트

4. Recovery (감소 및 회복):
   - 2분 동안 VU를 0명까지 점진적으로 감소
   - 서버의 정상 복귀 여부 확인

5. 다양한 메시지/채널 시나리오:
   - 20개의 채널과 50개의 다양한 메시지로 실제 서비스와 유사한 환경 재현
*/

import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// 📊 메트릭
const connectionSuccessRate = new Rate('ws_connection_success');
const messageSuccessRate = new Rate('ws_message_success');
const messageLatency = new Trend('ws_message_latency');
const totalConnections = new Counter('total_connections');
const totalMessages = new Counter('total_messages');
const errorCount = new Counter('error_count');

// 🧪 부하 옵션 (시나리오별)
export const options = {
  scenarios: {
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 200 }, // 2분 동안 200명까지 증가
      ],
      exec: 'rampUpScenario',
    },
    steady_state: {
      executor: 'constant-vus',
      vus: 200,
      duration: '3m', // 3분 동안 200명 유지
      exec: 'steadyStateScenario',
      startTime: '2m',
    },
    spike: {
      executor: 'constant-vus',
      vus: 300,
      duration: '1m', // 1분 동안 300명 동시 접속
      exec: 'spikeScenario',
      startTime: '5m',
    },
    recovery: {
      executor: 'ramping-vus',
      startVUs: 300,
      stages: [
        { duration: '2m', target: 0 }, // 2분 동안 0명까지 감소
      ],
      exec: 'recoveryScenario',
      startTime: '6m',
    },
  },
  thresholds: {
    'ws_connection_success': ['rate>0.95'],
    'ws_message_success': ['rate>0.95'],
    'ws_message_latency': ['p(95)<1000'],
    'error_count': ['count<100'],
  },
};

// 🧬 테스트 대상
const JWT = 'Bearer test-token';
const CHANNELS = Array.from({length: 20}, (_, i) => `channel-${i + 1}`);
const MESSAGES = Array.from({length: 50}, (_, i) => `성능테스트 메시지${i + 1}`);

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomMessage() {
  const messageTypes = ['TALK', 'IMAGE', 'FILE', 'SYSTEM'];
  const messageType = random(messageTypes);
  
  const baseMessage = {
    serverId: "test-server",
    email: `test${Math.floor(Math.random() * 1000)}@example.com`,
    writer: `test-user-${Math.floor(Math.random() * 1000)}`,
    content: random(MESSAGES),
    messageType: messageType,
    fileUrl: null,
    fileName: null
  };

  if (messageType === 'IMAGE' || messageType === 'FILE') {
    baseMessage.fileUrl = `https://example.com/files/${Math.random()}.${messageType === 'IMAGE' ? 'jpg' : 'pdf'}`;
    baseMessage.fileName = `test-file-${Math.random()}.${messageType === 'IMAGE' ? 'jpg' : 'pdf'}`;
  }

  return baseMessage;
}

function websocketTest() {
  const channelId = random(CHANNELS);
  const messageBody = generateRandomMessage();
  const url = 'ws://localhost:8081/ws';
  let messageSent = false;
  let messageReceived = false;
  const startTime = new Date();

  const res = ws.connect(url, (socket) => {
    socket.on('open', () => {
      connectionSuccessRate.add(1);
      totalConnections.add(1);
      const connectFrame = `CONNECT\naccept-version:1.1\nheart-beat:0,0\nAuthorization:${JWT}\n\n\0`;
      socket.send(connectFrame);
    });

    socket.on('message', (data) => {
      if (data.includes('CONNECTED')) {
        const subscribeFrame = `SUBSCRIBE\nid:sub-0\ndestination:/topic/chat.channel.${channelId}\n\n\0`;
        socket.send(subscribeFrame);
        sleep(0.5); // 대기 시간 감소

        const sendFrame =
          `SEND\n` +
          `destination:/pub/chat.message.${channelId}\n` +
          `content-type:application/json\n` +
          `Authorization:${JWT}\n` +
          `\n` +
          `${JSON.stringify(messageBody)}\0`;
        socket.send(sendFrame);
        messageSent = true;
        totalMessages.add(1);
      }

      if (data.includes('MESSAGE')) {
        try {
          const messageContent = data.split('\n\n')[1].replace(/\0$/, '').trim();
          const messageJson = JSON.parse(messageContent);
          if (messageJson.content === messageBody.content) {
            messageSuccessRate.add(1);
            messageReceived = true;
            messageLatency.add(new Date() - startTime);
            
            // 연결 종료
            const disconnectFrame = 'DISCONNECT\n\n\0';
            socket.send(disconnectFrame);
            socket.close();
          }
        } catch (e) {
          errorCount.add(1);
        }
      }

      if (data.includes('ERROR')) {
        errorCount.add(1);
        connectionSuccessRate.add(0);
        messageSuccessRate.add(0);
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
  sleep(0.5); // 대기 시간 감소
}

// 각 시나리오별로 함수 분리
export function rampUpScenario() { websocketTest(); }
export function steadyStateScenario() { websocketTest(); }
export function spikeScenario() { websocketTest(); }
export function recoveryScenario() { websocketTest(); } 