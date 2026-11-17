import { readFileSync } from 'node:fs';
const OLD = readFileSync('/tmp/good61b.js', 'utf8');
const NEW = readFileSync('/home/user/BOTFAKE-REWORK/scripts/pancake-send-lite.user.js', 'utf8');
function grab(src, name) {
  const start = src.indexOf(`function ${name}(`);
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(start, i + 1); } }
}
function run(src, tag) {
  const code = [
    grab(src, 'sockRouteOf'), grab(src, 'pageSocketUsable'),
    src.includes('function socketSkipReason') ? grab(src, 'socketSkipReason') : 'function socketSkipReason(){return "n/a";}',
  ].join('\n') + '\nreturn { sockRoute, sockRouteOf, pageSocketUsable, socketSkipReason };';
  const SOCK_LOST_BAN = 2;
  const sockRoute = {};
  const isPageAckDead = () => false;
  const m = new Function('sockRoute', 'isPageAckDead', 'SOCK_LOST_BAN', code)(sockRoute, isPageAckDead, SOCK_LOST_BAN);
  const PID = '694078980461601';
  const out = { tag };
  // Mô phỏng ĐÚNG dữ liệu log 19:00:54: 5 ca chứng minh vắng mặt thật, rồi 774 ca bị né
  const st = m.sockRouteOf(PID);
  for (let i = 0; i < 5; i++) { if ('lostSock' in st) st.absent++; else st.lost++; }  // như mã cũ: absent ⇒ lost++
  out.usableAfter5Absent = m.pageSocketUsable(PID);
  out.skipReason = m.socketSkipReason(PID);
  return out;
}
console.log(JSON.stringify([run(OLD, '1.92.61 (trước)'), run(NEW, '1.92.62 (sau)')], null, 1));
