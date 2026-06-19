const handlers = [];

function publish(topic, payload) {
  handlers.forEach((handler) => handler({ topic, payload }));
}

function subscribe(handler) {
  handlers.push(handler);
}

module.exports = { publish, subscribe };
