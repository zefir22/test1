import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.HAIRCUT_PASSWORD) throw new Error('Set HAIRCUT_PASSWORD');
const password = process.env.HAIRCUT_PASSWORD || randomBytes(12).toString('base64url');
const db = new DatabaseSync(process.env.HAIRCUT_DB_PATH || fileURLToPath(new URL('./bookings.sqlite', import.meta.url)));
db.exec('CREATE TABLE IF NOT EXISTS bookings (day TEXT, time TEXT, name TEXT, phone TEXT, PRIMARY KEY(day,time))');
const html = readFileSync(new URL('./index.html', import.meta.url));
const slots = Array.from({length: 18}, (_, i) => String(10 + Math.floor(i / 2)).padStart(2,'0') + (i % 2 ? ':30' : ':00'));
function currentTime() {
  return new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Yekaterinburg', dateStyle:'short', timeStyle:'short'}).format(new Date());
}
function validDay(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(day).toJSON()?.slice(0,10) === day && day >= currentTime().slice(0,10);
}
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  function json(status, data) {
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify(data));
  }
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/slots') {
      const day = url.searchParams.get('day');
      if (!validDay(day)) return json(400, {error:'Выберите сегодняшнюю или будущую дату.'});
      const busy = new Set(db.prepare('SELECT time FROM bookings WHERE day=?').all(day).map(row => row.time));
      return json(200, slots.filter(time => !busy.has(time) && day + ' ' + time > currentTime()));
    }
    if (req.method === 'GET' && url.pathname === '/journal') {
      const supplied = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from('Bearer ' + password);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(401, {error:'Неверный пароль.'});
      return json(200, db.prepare('SELECT * FROM bookings ORDER BY day,time').all());
    }
    if (req.method === 'POST' && url.pathname === '/book') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) return json(413, {error:'Слишком большой запрос.'});
      }
      const {day,time,name,phone} = JSON.parse(body) || {};
      if (!validDay(day) || !slots.includes(time) || day + ' ' + time <= currentTime() ||
          typeof name !== 'string' || !name.trim() || name.length > 80 ||
          typeof phone !== 'string' || !/^[+\d() -]{7,25}$/.test(phone) || phone.replace(/\D/g,'').length < 7) {
        return json(400, {error:'Проверьте дату, время, имя и телефон.'});
      }
      const result = db.prepare('INSERT OR IGNORE INTO bookings VALUES (?,?,?,?)').run(day,time,name.trim(),phone.trim());
      return result.changes ? json(201, {day,time}) : json(409, {error:'Это время уже занято. Выберите другое.'});
    }
    json(404, {error:'Страница не найдена.'});
  } catch (error) {
    if (error instanceof SyntaxError) return json(400, {error:'Некорректный запрос.'});
    console.error(error);
    json(500, {error:'Ошибка сервера. Попробуйте ещё раз.'});
  }
}).listen(Number(process.env.PORT || process.env.HAIRCUT_PORT || 8765), process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1'), function () {
  console.log('Listening on port ' + this.address().port);
  if (!process.env.HAIRCUT_PASSWORD) console.log('Admin password: ' + password);
});


