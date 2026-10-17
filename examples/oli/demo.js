import { OliCanvas } from '../../packages/oli/src/renderer.js';

const $ = selector => document.querySelector(selector);
const copy = {
  idle: ['Estoy aquí.', 'Sin prisa. Solo una pequeña presencia.'],
  listening: ['Te escucho.', 'Cuéntame. Tienes toda mi atención.'],
  thinking: ['Déjame pensarlo.', 'Las ideas también necesitan un poco de espacio.'],
  focused: ['Punto por punto.', 'A veces, el detalle lo cambia todo.'],
  understanding: ['Ahora lo veo.', 'Las pequeñas piezas empiezan a encajar.'],
  happy: ['Qué bueno verte.', 'Hay cosas que se dicen con una sonrisa.'],
  celebrating: ['¡Lo conseguimos!', 'Las buenas noticias mueven algo por dentro.'],
};
let oli;
let current = 'idle';
let paused = false;
let dark = true;
let sequenceTimer;
let sequenceRunning = false;
let sequenceIndex = 0;
let greetingTimer;
const states = Object.keys(copy);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

try {
  oli = new OliCanvas($('#oli'), { state: current, particles: 1800 });
} catch (error) {
  $('#error').hidden = false;
  $('#error').textContent = `${error.message} Prueba con una versión reciente de tu navegador.`;
  document.querySelectorAll('button').forEach(button => button.disabled = true);
}

function setState(state) {
  current = state;
  oli?.setState(state);
  $('#voice-title').textContent = copy[state][0];
  $('#voice-description').textContent = copy[state][1];
  document.querySelectorAll('[data-state]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.state === state));
  });
}

function stopSequence() {
  clearTimeout(sequenceTimer);
  sequenceRunning = false;
  $('#sequence').setAttribute('aria-pressed', 'false');
  $('#sequence span').textContent = 'Ver su historia';
  $('#sequence-caption').textContent = reduceMotion.matches ? 'Movimiento reducido activado.' : 'Una emoción lleva a otra.';
}

function updatePause() {
  oli?.setOptions({ paused });
  $('#pause').setAttribute('aria-pressed', String(paused));
  $('#pause').setAttribute('aria-label', paused ? 'Reanudar animación' : 'Pausar animación');
  $('#pause-label').textContent = paused ? 'Reanudar' : 'Pausar';
  $('#pause-icon').innerHTML = paused ? '<path d="m9 5 10 7-10 7Z"/>' : '<path d="M9 6v12M15 6v12"/>';
}

function nextState() {
  if (!sequenceRunning) return;
  if (sequenceIndex >= states.length) {
    setState('idle');
    stopSequence();
    return;
  }
  setState(states[sequenceIndex++]);
  $('#sequence-caption').textContent = `${sequenceIndex} de ${states.length} · Una pequeña historia.`;
  sequenceTimer = setTimeout(nextState, current === 'idle' ? 2200 : 4600);
}

document.querySelectorAll('[data-state]').forEach(button => {
  button.addEventListener('click', () => {
    stopSequence();
    clearTimeout(greetingTimer);
    setState(button.dataset.state);
  });
});

$('#sequence').addEventListener('click', () => {
  clearTimeout(greetingTimer);
  if (sequenceRunning) { stopSequence(); return; }
  paused = false;
  updatePause();
  sequenceRunning = true;
  sequenceIndex = 0;
  $('#sequence').setAttribute('aria-pressed', 'true');
  $('#sequence span').textContent = 'Detener historia';
  nextState();
});

$('#pause').addEventListener('click', () => {
  stopSequence();
  clearTimeout(greetingTimer);
  paused = !paused;
  updatePause();
});

$('#theme').addEventListener('click', () => {
  dark = !dark;
  document.documentElement.classList.toggle('light', !dark);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#141515' : '#f3f0e9';
  $('#theme').setAttribute('aria-label', dark ? 'Usar fondo claro' : 'Usar fondo oscuro');
  oli?.setOptions({ dark });
});

$('#greet').addEventListener('pointermove', event => {
  if (event.pointerType === 'touch') return;
  const box = $('#greet').getBoundingClientRect();
  oli?.lookAt((event.clientX - box.x) / box.width * 2 - 1, (event.clientY - box.y) / box.height * 2 - 1);
});
$('#greet').addEventListener('pointerleave', () => oli?.lookAt(0, 0));
$('#greet').addEventListener('click', event => {
  stopSequence();
  clearTimeout(greetingTimer);
  $('#touch-hint').classList.add('dismissed');
  const before = current;
  const box = $('#greet').getBoundingClientRect();
  const x = event.detail ? (event.clientX - box.x - box.width / 2) / (box.width * 0.355) : 0;
  const y = event.detail ? (event.clientY - box.y - box.height / 2) / (box.height * 0.355) : 0;
  oli?.ripple(x, y);
  setState(before === 'happy' ? 'celebrating' : 'happy');
  greetingTimer = setTimeout(() => setState(before), 3800);
});

$('#portrait').addEventListener('click', () => {
  const source = $('#oli');
  const image = document.createElement('canvas');
  image.width = source.width;
  image.height = source.height;
  const ctx = image.getContext('2d');
  ctx.fillStyle = dark ? '#141515' : '#f3f0e9';
  ctx.fillRect(0, 0, image.width, image.height);
  ctx.drawImage(source, 0, 0);
  image.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `oli-${current}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, 'image/png');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopSequence(); clearTimeout(greetingTimer); }
});
reduceMotion.addEventListener('change', stopSequence);
if (reduceMotion.matches) stopSequence();
window.addEventListener('pagehide', () => { stopSequence(); clearTimeout(greetingTimer); });
