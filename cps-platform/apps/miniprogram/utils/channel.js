const CHANNEL_PATTERN = /^[a-z0-9_-]{2,32}$/;

function validateChannel(value) {
  return typeof value === 'string' && CHANNEL_PATTERN.test(value) ? value : '';
}

function readChannel(query) {
  if (!query || typeof query !== 'object') return '';
  const direct = validateChannel(query.channel);
  if (direct) return direct;
  if (typeof query.scene !== 'string') return '';
  let scene;
  try { scene = decodeURIComponent(query.scene); } catch (_) { return ''; }
  const plain = validateChannel(scene);
  if (plain) return plain;
  const entry = scene.split('&').find((part) => part.startsWith('channel='));
  return entry ? validateChannel(entry.slice('channel='.length)) : '';
}

module.exports = { readChannel, validateChannel };
