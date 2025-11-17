
// Minimal no-op service worker – same idea as before
self.addEventListener('install', event => {
	self.skipWaiting();
});

self.addEventListener('activate', event => {
	self.clients.claim();
});

self.addEventListener('fetch', () => {
	// passthrough – you can add caching later if you want
});



