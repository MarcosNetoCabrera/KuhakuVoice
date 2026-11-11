const cancel = () => window.picker.choose(null);
document.getElementById('cancel').onclick = cancel;
addEventListener('keydown', e => { if (e.key === 'Escape') cancel(); });

window.picker.sources().then(list => {
  for (const s of list) {
    const b = document.createElement('button');
    b.className = 'source';
    const img = document.createElement('img');
    img.src = s.thumb;
    img.alt = '';
    const name = document.createElement('span');
    name.textContent = s.name; // window titles are untrusted text, never HTML
    b.append(img, name);
    b.onclick = () => window.picker.choose(s.id);
    document.getElementById(s.screen ? 'screens' : 'windows').append(b);
  }
  document.querySelector('.source')?.focus();
});
