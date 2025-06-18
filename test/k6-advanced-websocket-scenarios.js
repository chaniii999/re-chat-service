/*
[시나리오 요약]

1. Ramp-up (점진적 증가):
   - 1분 동안 VU(가상 사용자)를 10명까지 점진적으로 증가시켜 연결 및 메시지 송수신 테스트

2. Steady-state (유지):
   - 2분 동안 10명의 VU가 지속적으로 메시지를 송수신하며 서버의 안정성 확인

3. Spike (급격한 증가):
   - 30초 동안 30명의 VU가 동시에 접속하여 순간적인 부하 상황을 시뮬레이션

4. Recovery (감소 및 회복):
   - 1분 동안 VU를 0명까지 점진적으로 감소시켜 서버의 정상 복귀 여부 확인

5. 다양한 메시지/채널 시나리오:
   - 각 VU는 임의의 채널과 메시지를 선택하여 송수신, 실제 서비스와 유사한 환경을 재현
*/

import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// 📊 메트릭
const connectionSuccessRate = new Rate('ws_connection_success');
const messageSuccessRate = new Rate('ws_message_success');
const messageLatency = new Trend('ws_message_latency');

// 🧪 부하 옵션 (시나리오별)
export const options = {
  scenarios: {
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 10 }, // 1분 동안 10명까지 증가
      ],
      exec: 'rampUpScenario',
    },
    steady_state: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m', // 2분 동안 10명 유지
      exec: 'steadyStateScenario',
      startTime: '1m',
    },
    spike: {
      executor: 'constant-vus',
      vus: 30,
      duration: '30s', // 30초 동안 30명 동시 접속
      exec: 'spikeScenario',
      startTime: '3m',
    },
    recovery: {
      executor: 'ramping-vus',
      startVUs: 30,
      stages: [
        { duration: '1m', target: 0 }, // 1분 동안 0명까지 감소
      ],
      exec: 'recoveryScenario',
      startTime: '3m30s',
    },
  },
  thresholds: {
    'ws_connection_success': ['rate>0.95'],
    'ws_message_success': ['rate>0.95'],
    'ws_message_latency': ['p(95)<1000'],
  },
};

// 🧬 테스트 대상
const JWT = 'Bearer test-token';
const CHANNELS = ['channel-1', 'channel-2', 'channel-3', 'channel-4', 'channel-5'];
const MESSAGES = [
  '성능테스트 메시지1', '성능테스트 메시지2', '성능테스트 메시지3',
  '성능테스트 메시지4', '성능테스트 메시지5', '성능테스트 메시지6',
  '성능테스트 메시지7', '성능테스트 메시지8', '성능테스트 메시지9', '성능테스트 메시지10'
];

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function websocketTest() {
  const channelId = random(CHANNELS);
  const messageText = random(MESSAGES);
  const url = 'ws://localhost:8081/ws';
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
        sleep(1);
        const messageBody = JSON.stringify({
          serverId: "test-server",
          email: "test@example.com",
          writer: "test-user",
          content: messageText,
          messageType: "TALK",
          fileUrl: null,
          fileName: null
        });
        const sendFrame =
          `SEND\n` +
          `destination:/pub/chat.message.${channelId}\n` +
          `content-type:application/json\n` +
          `Authorization:${JWT}\n` +
          `\n` +
          `${messageBody}\0`;
        socket.send(sendFrame);
        messageSent = true;
      }
      if (data.includes('MESSAGE')) {
        try {
          const messageContent = data.split('\n\n')[1].replace(/\0$/, '').trim();
          const messageJson = JSON.parse(messageContent);
          if (messageJson.content === messageText) {
            messageSuccessRate.add(1);
            messageReceived = true;
            // 연결 종료
            const disconnectFrame = 'DISCONNECT\n\n\0';
            socket.send(disconnectFrame);
            socket.close();
          }
        } catch (e) {
          // 파싱 실패 무시
        }
      }
    });
    socket.on('close', () => {
      if (!messageReceived && messageSent) {
        messageSuccessRate.add(0);
      }
    });
    socket.on('error', (e) => {
      connectionSuccessRate.add(0);
      messageSuccessRate.add(0);
    });
  });
  check(res, { '연결 성공': (r) => r && r.status === 101 });
  sleep(1);
}

// 각 시나리오별로 함수 분리 (실제 동작은 동일, 옵션만 다름)
export function rampUpScenario() { websocketTest(); }
export function steadyStateScenario() { websocketTest(); }
export function spikeScenario() { websocketTest(); }
export function recoveryScenario() { websocketTest(); } 