import { betterAuth } from 'better-auth';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { APIError } from 'better-auth/api';
import pg from 'pg';
import configuration from './commercialConfig.js';
import mail from './accountMail.js';

const settings = configuration.config();
const database = new pg.Pool({
    connectionString:process.env.CANQUERY_DATABASE_URL || process.env.OPENCANADA_DATABASE_URL,
    options:'-c search_path=canquery_auth,public', max:4,
    connectionTimeoutMillis:5000, statement_timeout:30000, idleTimeoutMillis:30000
});
database.on('error',()=>console.error('CanQuery authentication database connection failed'));
export const auth = betterAuth({
    appName:'CanQuery', baseURL:settings.origin, basePath:'/api/auth',
    secret:process.env.BETTER_AUTH_SECRET, database,
    trustedOrigins:[settings.origin],
    user:{additionalFields:{termsVersion:{type:'string',required:true},termsAcceptedAt:{type:'date',input:false,required:false}}},
    emailAndPassword:{ enabled:true, requireEmailVerification:true, minPasswordLength:12,
        revokeSessionsOnPasswordReset:true, resetPasswordTokenExpiresIn:1800,
        sendResetPassword:(data,request)=>mail.enqueueAccountMail(data,'reset',request) },
    emailVerification:{sendOnSignUp:true,sendOnSignIn:true,expiresIn:86400,
        sendVerificationEmail:(data,request)=>mail.enqueueAccountMail(data,'verify',request)},
    session:{expiresIn:7*86400,updateAge:86400,cookieCache:{enabled:false}},
    advanced:{useSecureCookies:settings.origin.startsWith('https://'),ipAddress:{disableIpTracking:true}},
    // authRuntime enforces atomic PostgreSQL limits using HMAC IP buckets.
    // Better Auth's built-in limiter depends on persisting/resolving raw IPs.
    rateLimit:{enabled:false,storage:'database'},
    logger:{disabled:true},
    databaseHooks:{
        user:{create:{before:async user=>{
            if (user.termsVersion !== '2026-10-06') throw new APIError('BAD_REQUEST',{message:'Accept the current CanQuery terms to create an account',code:'TERMS_REQUIRED'});
            return {data:{...user,termsAcceptedAt:new Date()}};
        }}},
        session:{create:{before:async session=>({data:{...session,ipAddress:null,userAgent:null}})}}
    }
});
export const handler = toNodeHandler(auth);
export const getSession = headers => auth.api.getSession({headers:fromNodeHeaders(headers)});
export const close = () => database.end();
