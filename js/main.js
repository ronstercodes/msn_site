// Mobile menu toggle
const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');

if (toggle) {
  toggle.addEventListener('click', () => {
    nav.classList.toggle('open');
  });
}

// Lightbox for gallery images
const galleryLinks = Array.from(document.querySelectorAll('.gallery a'));

if (galleryLinks.length) {
  const lightbox = document.createElement('div');
  lightbox.className = 'lightbox';
  lightbox.innerHTML =
    '<button class="lb-close" aria-label="Close">&times;</button>' +
    '<button class="lb-prev" aria-label="Previous">&#8249;</button>' +
    '<button class="lb-next" aria-label="Next">&#8250;</button>' +
    '<img alt="">';
  document.body.appendChild(lightbox);

  const lbImg = lightbox.querySelector('img');
  let current = 0;

  const show = i => {
    current = (i + galleryLinks.length) % galleryLinks.length;
    lbImg.src = galleryLinks[current].href;
    lightbox.classList.add('open');
  };

  const close = () => lightbox.classList.remove('open');

  galleryLinks.forEach((link, i) => {
    link.addEventListener('click', e => {
      e.preventDefault();
      show(i);
    });
  });

  lightbox.querySelector('.lb-close').addEventListener('click', close);
  lightbox.querySelector('.lb-prev').addEventListener('click', () => show(current - 1));
  lightbox.querySelector('.lb-next').addEventListener('click', () => show(current + 1));

  lightbox.addEventListener('click', e => {
    if (e.target === lightbox) close();
  });

  document.addEventListener('keydown', e => {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') show(current - 1);
    if (e.key === 'ArrowRight') show(current + 1);
  });
}
