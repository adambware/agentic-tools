const messages = [];

function publish(topic, payload) {
  messages.push({ topic, payload });
}

module.exports = { publish, messages };
