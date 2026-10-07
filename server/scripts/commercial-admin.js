#!/usr/bin/env node
require('dotenv/config');
const fs=require('fs');
const admin=require('../services/commercialAdmin');
const pool=require('../db/pool');
const {verifyEnvironment,ensureCustomer}=require('../services/billingService');
const {adoptActivePreparations}=require('../db/preparationAccounting');

async function main() {
    const [action,accountId,inputFile,...flags]=process.argv.slice(2);
    if (!['status','inspect','preparation-adoption','customer','grant','suspend','resume','delete-account'].includes(action)) throw new Error('Usage: commercial-admin.js status | inspect ACCOUNT | preparation-adoption [PREVIEW.json --apply] | grant ACCOUNT INPUT.json [--apply] | customer|suspend|resume|delete-account ACCOUNT [--apply]');
    if (action==='status') return admin.status();
    if (action==='preparation-adoption') {
        if (inputFile!=='--apply') return adoptActivePreparations();
        await verifyEnvironment();
        const preview=JSON.parse(fs.readFileSync(accountId,'utf8'));
        return adoptActivePreparations(pool,{apply:true,candidates:preview.candidates.filter(c=>c.eligible)});
    }
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(accountId||'')) throw new Error('Use a canonical account UUID');
    const current=await admin.inspect(accountId);
    if(action==='inspect') return current;
    const input=action==='grant' ? admin.grantInput(JSON.parse(fs.readFileSync(inputFile,'utf8'))) : null;
    if (!(flags.includes('--apply') || inputFile==='--apply')) return {preview:true,action,current,input};
    await verifyEnvironment();
    if(action==='customer') {
        const owner=(await pool.query('SELECT name,email FROM canquery_auth."user" WHERE id=$1 AND "emailVerified"',[current.account.owner_id])).rows[0];
        if(!owner) throw new Error('Verified account owner required');
        return {customer:await ensureCustomer(accountId,owner)};
    }
    if(action==='grant') return admin.grant(accountId,input);
    if(action==='delete-account') return admin.deleteAccount(accountId);
    await admin.setSuspended(accountId,action==='suspend');
    return {accountId,suspended:action==='suspend'};
}
main().then(value=>console.log(JSON.stringify(value,null,2))).catch(err=>{
    console.error(err.isOperational ? err.message : 'Commercial operation failed; inspect configuration and the private operation record.');process.exitCode=1;
}).finally(()=>pool.end());
