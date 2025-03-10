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
    topics: ["Welcome to the stream!", "Talk about your favorite game."],
    moods: {
        happy: ["fun", "joke", "celebrate"],
        serious: ["dark", "serious"],
        neutral: []
    },
    expressions: {
        happy: "expressionSmile",
        serious: "expressionSad",
        neutral: "expressionNeutral"
    },
    chatHandling: {
        maxRecentMessages: 20
    },
    cooldowns: {
        topicCooldownMinutes: 10
    },
    moderation: {
        autoModerate: true,
        deleteFilteredMessages: true
    }
};

let cooldowns = new Set();
let twitchMessages = [];
let currentMood = "neutral";
let vtubeStudio = null;

function log(msg) {
    postMessage({ type: "log", content: `[AI VTuber Plugin] ${msg}` });
}

function loadConfig() {
    postMessage({ type: "readFile", file: "config.json" });
}

function saveConfig() {
    postMessage({ type: "writeFile", file: "config.json", content: JSON.stringify(config, null, 2) });
}

function pickTopic() {
    const available = config.topics.filter(t => !cooldowns.has(t));
    if (available.length === 0) {
        cooldowns.clear();
        return config.topics[Math.floor(Math.random() * config.topics.length)];
    }
    const topic = available[Math.floor(Math.random() * available.length)];
    cooldowns.add(topic);
    setTimeout(() => cooldowns.delete(topic), config.cooldowns.topicCooldownMinutes * 60000);
    return topic;
}

function postSystemMessage(message) {
    postMessage({ type: "send_message", content: `(System: ${message})` });
}

function postAIMessage(prompt) {
    postMessage({ type: "generate_message", content: prompt });
}

function setExpression(mood) {
    if (!vtubeStudio || vtubeStudio.readyState !== WebSocket.OPEN) return;
    const expression = config.expressions[mood] || config.expressions.neutral;

    vtubeStudio.send(JSON.stringify({
        apiName: "VTubeStudioPublicAPI",
        apiVersion: "1.0",
        requestID: `setExpression-${mood}`,
        messageType: "HotkeyTriggerRequest",
        data: { hotkeyID: expression }
    }));
}

function handleGeneratedMessage(message) {
    postMessage({ type: "send_message", content: message });
}

function triggerMonologue() {
    const topic = pickTopic();
    postSystemMessage(`AI starts a monologue about: ${topic}`);
    postAIMessage(`Talk about: ${topic}`);

    setMoodBasedOnTopic(topic);
    setExpression(currentMood);

    scheduleNextMonologue();
}

function scheduleNextMonologue() {
    const delay = Math.floor(Math.random() * (config.intervals.maxSeconds - config.intervals.minSeconds) + config.intervals.minSeconds) * 1000;
    setTimeout(triggerMonologue, delay);
}

function setMoodBasedOnTopic(topic) {
    currentMood = "neutral";
    for (const [mood, triggers] of Object.entries(config.moods)) {
        if (triggers.some(trigger => topic.toLowerCase().includes(trigger))) {
            currentMood = mood;
            break;
        }
    }
}

function handleIncomingMessage(event) {
    const { type, file, content } = event.data;

    if (type === "readFileResult" && file === "config.json") {
        if (content) {
            try {
                config = JSON.parse(content);
            } catch (err) {
                log(`Failed to parse config.json: ${err.message}`);
            }
        } else {
            log("No config.json found, generating default.");
            saveConfig();
        }

        setupVTubeStudioConnection();
        scheduleNextMonologue();
    }

    if (type === "generated_message") {
        handleGeneratedMessage(content);
    }

    if (type === "incoming_chat_message") {
        if (!passesFilter(content)) return;

        twitchMessages.push(content);
        if (twitchMessages.length > config.chatHandling.maxRecentMessages) {
            twitchMessages.shift();
        }
    }
}

function passesFilter(message) {
    return !config.filters.bannedWords.some(badWord => message.toLowerCase().includes(badWord));
}

function setupVTubeStudioConnection() {
    if (vtubeStudio) {
        vtubeStudio.close();
    }

    vtubeStudio = new WebSocket(`ws://${config.vtubeStudio.host}:${config.vtubeStudio.port}`);

    vtubeStudio.onopen = () => {
        log("Connected to VTube Studio.");
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
    };

    vtubeStudio.onerror = (err) => {
        log(`VTube Studio connection error: ${err.message}`);
    };

    vtubeStudio.onclose = () => {
        log("VTube Studio connection closed. Reconnecting in 30 seconds...");
        setTimeout(setupVTubeStudioConnection, 30000);
    };
}

// === Initial Startup ===
log("AI VTuber Plugin loading...");
loadConfig();

// Listen for SillyTavern extension messages
onmessage = handleIncomingMessage;
