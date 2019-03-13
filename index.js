#!/usr/bin/env node

const redisModule = require('async-redis');
const TelegramBot = require('node-telegram-bot-api');

// Config
const redisURL = process.env.REDIS_URL;
const redisPrefix = process.env.REDIS_PREFIX || 'TELEGRAM_XP_';
const telegramToken = process.env.TELEGRAM_TOKEN;
const minXP = parseInt(process.env.MIN_XP) || 15;
const rateLimit = parseInt(process.env.RATE_LIMIT) || 15;

if (!telegramToken) {
    console.error("Error: $TELEGRAM_TOKEN not set.");
    process.exit(1);
}

// APIs
const bot = new TelegramBot(telegramToken, {polling: true});
const redis = redisModule.createClient(redisURL);

// Triggers
bot.on('text',    incrementXP);
bot.on('voice',   incrementXP);
bot.on('sticker', incrementXP);
bot.on('photo',    moderateContent);
bot.on('video',    moderateContent);
bot.on('document', moderateContent);

// Commands
bot.onText(/\/start/,     displayHelp);
bot.onText(/\/xp(@\w+)?/, displayRank);
bot.onText(/\/ranks/,     displayTopRanks);

async function incrementXP(msg, match) {
    const uid = msg.from.id;
    const gid = msg.chat.id;
    const key = redisPrefix + gid;

    if (msg.chat.type == "private")
        return;

    if (msg.text && msg.text.match(/\/xp/))
        return;

    const entities = msg.entities || [];
    const isLink = entities.find(e => e.type == 'text_link');

    if (isLink)
        if (!(await moderateContent(msg, match)))
            return;

    if (rateLimit) {
        const ukey = redisPrefix + "_USER_" + uid;

        if (await redis.exists(ukey))
            return;

        await redis.set(ukey, 1);
        await redis.expire(ukey, rateLimit);
    }

    await redis.zincrby(key, 1, uid);
}

async function displayRank(msg, match) {
    const uid = msg.from.id;
    const gid = msg.chat.id;
    const key = redisPrefix + gid;

    if (msg.chat.type == "private") {
        bot.sendMessage(gid, "Sorry, you can't gain XP in private chats.");
        return;
    }

    const score = await redis.zscore(key, uid);
    if (!score) {
        bot.sendMention(gid, msg.from, ", you're not ranked yet 👶");
        return;
    }

    const rank =  (await redis.zrevrank(key, uid)) + 1;
    const total = await redis.zcard(key);

    if (score >= minXP) {
        const next = await redis.zrangebyscore(key, parseInt(score) + 2, '+inf', 'withscores', 'limit', 0, 1);
        if (!next || next.length == 0) {
            bot.sendMention(gid, msg.from, `, you have ${score} XP  ◎  Rank ${rank} / ${total}  ◎  𝙺𝚒𝚗𝚐 𝙽𝙸𝙼𝙸𝚀 👑`);
        } else {
            const member = await bot.getChatMember(gid, next[0]);
            const rival = member.user || { id: '', first_name: '???' };
            bot.sendMention(gid, msg.from, `, you have ${score} XP  ◎  Rank ${rank} / ${total}  ◎  ${next[1]-score} to beat ${withUser(rival)}!`)
        }
    } else {
        bot.sendMention(gid, msg.from, `, your rank is ${rank} / ${total}.`);
    }
}

async function displayTopRanks(msg, match) {
    const gid = msg.chat.id;
    const key = redisPrefix + gid;

    if (msg.chat.type == "private") {
        bot.sendMessage(gid, "Please add me to a group.");
        return;
    }

    const total = await redis.zcard(key);
    if (total < 3)
        return;

    const scores = await redis.zrevrange(key, 0, 3, "withscores");
    let users = [];
    for (let i = 0; i < 3; i++) {
        const member = await bot.getChatMember(gid, scores[i*2]);
        if (member && member.user)
            users[i] = member.user;
        else
            users[i] = {id: 0, first_name: 'A ghost'};
    }

    bot.sendMessage(gid,
        `🥇 ${withUser(users[0])}: ${scores[1]} XP \n` +
        `🥈 ${withUser(users[1])}: ${scores[3]} XP \n` +
        `🥉 ${withUser(users[2])}: ${scores[5]} XP`,
        { parse_mode: 'Markdown', disable_notification: true });
}

async function moderateContent(msg, match) {
    const uid = msg.from.id;
    const gid = msg.chat.id;
    const key = redisPrefix + gid;

    if (msg.chat.type == "private")
        return;

    const score = await redis.zscore(key, uid);

    if (score < minXP) {
        bot.deleteMessage(msg.chat.id, msg.message_id);
        bot.sendMention(gid, msg.from, " Sorry, but you don't have enough XP to send that. You can earn XP by talking 😉");
        await redis.zrem(key, uid);
        return false;
    }

    return true;
}

async function displayHelp(msg, match) {
    if (msg.chat.type != "private")
        return;
    bot.sendMessage(msg.chat.id, "Hi, I'm XP Bot. Add me to a group and I will track users' message count (XP). " +
        "Available commands:\n" +
        " - /xp displays the XP count and rank of the user\n" +
        " - /ranks displays the top 3");
}

function withUser(user) {
    return user.first_name;
    //return `[${user.first_name}](tg://user?id=${user.id})`;
}

bot.sendMention = (gid, user, text) => {
    bot.sendMessage(gid, withUser(user) + text, { parse_mode: 'Markdown', disable_notification: true });
}