const WebSocket = require('ws');
const tmi = require('tmi.js');
const fs = require('fs');
const { randomInt } = require('crypto');

let tavern, aiCharacter, twitchClient, vtubeStudio;
let currentMood = "neutral";
let cooldowns = new Set();
let twitchMessages = [];

const configPath = __dirname + '/config.json';

let config = {
    twitch: {
        channel: "",
        botName: "",
        oauthToken: ""
    },
    vtubeStudio: {
        host: "localhost",
        port: 8001
    },
    intervals: {
        minSeconds: 300,
        maxSeconds: 600
    },
    filters: {
        bannedWords: ["slur1", "slur2"]
    },
    topics: ["Welcome to the stream!", "Talk about your favorite game.", "What’s your dream vacation?"],
    moods: {
        happy: ["fun", "joke", "celebrate"],
        serious: ["dark", "serious", "deep topic"],
        neutral: []
    },
    expressions: {
        happy: "expressionSmile",
        serious: "expressionSad",
        neutral: "expressionNeutral"
    },
    chatHandling: {
        maxRecentMessages: 20,
        priorityKeywords: ["question", "important", "urgent"]
    },
    cooldowns: {
        topicCooldownMinutes: 10
    },
    moderation: {
        autoModerate: true,
        deleteFilteredMessages: true
    }
};

// Load or generate config file
if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));  // FIXED
} else {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log("[AI VTuber Plugin] Created default config.json - fill this out!");
}

// Entry point from SillyTavern
function setup(tavernInstance) {
    tavern = tavernInstance;
    aiCharacter = tavern.character;

    connectToTwitch();
    connectToVTubeStudio();

    scheduleNextDialogue();
    tavern.on('chat', handleUserMessage);
    tavern.on('chat_message', handleTwitchMessage);
}

// === Twitch Connection ===
function connectToTwitch() {
    twitchClient = new tmi.Client({
        identity: {
            username: config.twitch.botName,
            password: config.twitch.oauthToken
        },
        channels: [config.twitch.channel]
    });

    twitchClient.connect().then(() => {
        console.log(`[AI VTuber Plugin] Connected to Twitch chat for ${config.twitch.channel}`);
    }).catch(err => {
        console.error("[AI VTuber Plugin] Failed to connect to Twitch:", err);
    });

    twitchClient.on('message', (channel, userstate, message) => {
        if (!passesFilter(message)) return;

        twitchMessages.push({ user: userstate['display-name'], text: message });
        if (twitchMessages.length > config.chatHandling.maxRecentMessages) twitchMessages.shift();

        if (message.toLowerCase().includes(aiCharacter.name.toLowerCase())) {
            const response = aiCharacter.prompt(`Viewer ${userstate['display-name']} asked: "${message}"`);
            tavern.send(response);
        }
    });
}

// === VTube Studio Connection ===
function connectToVTubeStudio() {
    vtubeStudio = new WebSocket(`ws://${config.vtubeStudio.host}:${config.vtubeStudio.port}`);

    vtubeStudio.on('open', () => {
        console.log("[AI VTuber Plugin] Connected to VTube Studio.");
        authenticateVTS();
    });

    vtubeStudio.on('error', err => {
        console.error("[AI VTuber Plugin] VTube Studio connection error:", err);
    });
}

function authenticateVTS() {
    vtubeStudio.send(JSON.stringify({
        apiName: "VTubeStudioPublicAPI",
        apiVersion: "1.0",
        requestID: "auth",
        messageType: "AuthenticationRequest",
        data: {
            pluginName: "AI VTuber Plugin",
            pluginDeveloper: "Vestra Locke"
        }
    }));
}

// === Dialogue & Topic Handling ===
function scheduleNextDialogue() {
    const delay = randomInt(config.intervals.minSeconds, config.intervals.maxSeconds) * 1000;
    setTimeout(triggerAutoDialogue, delay);
}

function triggerAutoDialogue() {
    const topic = pickWeightedTopic();
    const dialogue = aiCharacter.prompt(`Talk about: ${topic}`);

    tavern.send(dialogue);
    setMoodBasedOnTopic(topic);
    setExpression(currentMood);

    scheduleNextDialogue();
}

function handleUserMessage(message) {
    if (message.startsWith("change topic:")) {
        const newTopic = message.replace("change topic:", "").trim();
        if (newTopic) {
            config.topics.push(newTopic);
            tavern.send(`(System: Added new topic - ${newTopic})`);
        }
    }
}

function handleTwitchMessage(message) {
    // Optional: react to Twitch chat from within SillyTavern context
}

// === Topic Management ===
function pickWeightedTopic() {
    const availableTopics = config.topics.filter(topic => !cooldowns.has(topic));

    if (availableTopics.length === 0) {
        cooldowns.clear();  // Reset after full cycle
        return config.topics[randomInt(config.topics.length)];
    }

    const topic = availableTopics[randomInt(availableTopics.length)];
    cooldowns.add(topic);
    setTimeout(() => cooldowns.delete(topic), config.cooldowns.topicCooldownMinutes * 60000);

    return topic;
}

// === Mood Handling ===
function setMoodBasedOnTopic(topic) {
    currentMood = "neutral";  // Default mood

    for (const [mood, triggers] of Object.entries(config.moods)) {
        if (triggers.some(trigger => topic.toLowerCase().includes(trigger))) {
            currentMood = mood;
            break;
        }
    }
}

// === VTube Studio Expression Trigger ===
function setExpression(mood) {
    const expression = config.expressions[mood] || config.expressions.neutral;

    vtubeStudio.send(JSON.stringify({
        apiName: "VTubeStudioPublicAPI",
        apiVersion: "1.0",
        requestID: `setExpression-${mood}`,
        messageType: "HotkeyTriggerRequest",
        data: { hotkeyID: expression }
    }));
}

// === Moderation & Filtering ===
function passesFilter(message) {
    const lowered = message.toLowerCase();
    return !config.filters.bannedWords.some(badWord => lowered.includes(badWord));
}

// === Export Plugin to SillyTavern ===
module.exports = {
    name: "AI VTuber Plugin",
    setup
};
