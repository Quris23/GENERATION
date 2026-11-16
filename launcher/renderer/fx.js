// End-style feedback for every button: a soft shimmer on hover, a portal "whoosh" on click and a puff of purple
// End particles from where it was clicked. Sounds are synthesized here (Web Audio), no sound files.
let ctx = null;
const audio = () => {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};
const UI_VOLUME = 0.5;

function tone(type, from, to, start, length, gain) {
  const a = audio();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, a.currentTime + start);
  o.frequency.exponentialRampToValueAtTime(to, a.currentTime + start + length);
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain * UI_VOLUME, a.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + length);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + length + 0.05);
}

function whoosh(length, fromHz, toHz, gain) {
  const a = audio();
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * length), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const band = a.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 6;
  band.frequency.setValueAtTime(fromHz, a.currentTime);
  band.frequency.exponentialRampToValueAtTime(toHz, a.currentTime + length);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, a.currentTime);
  g.gain.exponentialRampToValueAtTime(gain * UI_VOLUME, a.currentTime + length * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + length);
  src.connect(band).connect(g).connect(a.destination);
  src.start();
}

const sounds = {
  hover() {
    const base = 900 + Math.random() * 300;
    tone('sine', base, base * 1.5, 0, 0.12, 0.02);
    tone('sine', base * 1.5, base * 1.25, 0.04, 0.12, 0.012);
  },
  click() {
    whoosh(0.32, 2400, 260, 0.09);
    tone('triangle', 520, 140, 0, 0.3, 0.05);
  },
  play() {   // the big button: a deeper, longer portal
    whoosh(0.9, 1800, 120, 0.12);
    tone('sine', 220, 110, 0, 0.9, 0.07);
    tone('sine', 330, 165, 0.05, 0.85, 0.04);
    tone('sine', 660, 990, 0.1, 0.6, 0.015);
  },
};

// End particles: little purple squares flying out, then drifting and fading like the ones around an Enderman
function particles(x, y, count) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'end-particle';
    const size = 3 + Math.random() * 4;
    p.style.width = p.style.height = `${size}px`;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = ['#c46cff', '#9b3fe0', '#e6b3ff', '#7a2fbf'][i % 4];
    document.body.append(p);
    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 60;
    const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist;
    p.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * 0.7}px), calc(-50% + ${dy * 0.7}px)) scale(0.9)`, opacity: 0.9, offset: 0.4 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy - 25}px)) scale(0.2)`, opacity: 0 },
    ], { duration: 700 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => p.remove();
  }
}

let lastHover = null;
document.addEventListener('pointerover', e => {
  const b = e.target.closest('button');
  if (!b || b === lastHover || b.disabled) return;
  lastHover = b;
  sounds.hover();
});
document.addEventListener('pointerout', e => {
  if (e.target.closest('button') === lastHover && !lastHover.contains(e.relatedTarget)) lastHover = null;
});
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const big = b.id === 'play';
  (big ? sounds.play : sounds.click)();
  particles(e.clientX, e.clientY, big ? 26 : 12);
});
// sliders and switches get the hover shimmer when changed
document.addEventListener('change', e => {
  if (e.target.matches('input[type=range], input[type=checkbox]')) sounds.hover();
});
