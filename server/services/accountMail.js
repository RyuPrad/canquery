const { randomUUID, randomBytes, createHash, createCipheriv, createDecipheriv } = require('crypto');
const nodemailer = require('nodemailer');
const pool = require('../db/pool');
const { transaction } = require('../db/commercialQueries');

function key() {
    if (!process.env.BETTER_AUTH_SECRET) throw new Error('Missing mail encryption secret');
    return createHash('sha256').update('canquery-mail-v1\0'+process.env.BETTER_AUTH_SECRET).digest();
}
function encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm',key(),iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');
}
function decrypt(value) {
    const data = Buffer.from(value,'base64');
    const decipher = createDecipheriv('aes-256-gcm',key(),data.subarray(0,12));
    decipher.setAuthTag(data.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8'));
}
async function enqueueAccountMail({user,url},kind,request) {
    const fr = request?.headers.get('accept-language')?.startsWith('fr');
    const reset = kind === 'reset';
    const subject = fr ? (reset ? 'Réinitialisez votre mot de passe CanQuery' : 'Confirmez votre adresse courriel CanQuery')
        : (reset ? 'Reset your CanQuery password' : 'Verify your CanQuery email');
    const text = fr ? `${subject}\n\n${url}\n\nSi vous n’avez pas demandé ce message, ignorez-le.\nAide : support@canquery.com`
        : `${subject}\n\n${url}\n\nIf you did not request this message, you can ignore it.\nHelp: support@canquery.com`;
    await pool.query('INSERT INTO commercial.mail_outbox(id,user_id,payload) VALUES ($1,$2,$3)',[randomUUID(),user.id,encrypt({to:user.email,subject,text})]);
}
async function deliverMail(db = pool, transport) {
    if (!transport && !process.env.SMTP_HOST) return;
    const smtp = transport || nodemailer.createTransport({
        host:process.env.SMTP_HOST, port:Number(process.env.SMTP_PORT || 587), secure:false,
        requireTLS:process.env.SMTP_REQUIRE_TLS !== 'false',
        auth:process.env.SMTP_USER ? {user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD} : undefined,
        tls:{servername:process.env.SMTP_SERVERNAME || process.env.SMTP_HOST},
        connectionTimeout:5000,greetingTimeout:5000,socketTimeout:10000,
        disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false
    });
    await transaction(async client => {
        await client.query("DELETE FROM commercial.mail_outbox WHERE created_at<now()-interval '1 day'");
        const { rows } = await client.query(`SELECT * FROM commercial.mail_outbox WHERE available_at<=now() AND attempts<5
            ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
        if (!rows[0]) return;
        const row = rows[0];
        try {
            const message = decrypt(row.payload);
            await smtp.sendMail({...message,from:'CanQuery <accounts@canquery.com>',replyTo:'support@canquery.com',
                envelope:{from:'accounts@canquery.com',to:message.to}});
            await client.query('DELETE FROM commercial.mail_outbox WHERE id=$1',[row.id]);
        } catch {
            await client.query("UPDATE commercial.mail_outbox SET attempts=attempts+1,available_at=now()+make_interval(secs=>60*power(2,attempts)::int) WHERE id=$1",[row.id]);
            console.error('CanQuery account email delivery failed; retry retained');
        }
    },db);
    if (!transport) smtp.close();
}
module.exports = { enqueueAccountMail, deliverMail, encrypt, decrypt };
