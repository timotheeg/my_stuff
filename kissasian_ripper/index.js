const chromeLauncher = require('chrome-launcher');
const CDP = require('chrome-remote-interface');
const Promise = require('bluebird');
const request = require('request');
const fs = require('fs');
const path = require('path');
const parseMs = require('parse-ms');

const SAVE_DIR = '/Users/tgroleau/tmp/kissasian/';
const CHECKPOINT = '.checkpoint';
const SLEEP_TIME = 20 * 1000; // 20s in between each page navigation
const KAR_URL_RE = /^(.+\/([^/]+)\/)(Episode-([0-9-]+)[^\/]+)$/;

// Optional: set logging level of launcher to see its output.
// Install it using: yarn add lighthouse-logger
// const log = require('lighthouse-logger');
// log.setLevel('info');

class KissAsianRipper {
	constructor(url) {
		if (!url) {
			// in case no url supplied, use url from checkpoint if any
			url = fs.readFileSync(path.join(__dirname, CHECKPOINT)).toString().trim();
		}

		// we break appart url to find show details
		// sample url: http://kissasian.com/Drama/The-Master-s-Sun/Episode-1?id=1350
		let m = url.match(KAR_URL_RE);

		if (!m) throw new Error('Invalid URL: ' + url);

		this.start_url = url;
		this.base_url = m[1];
		this.show_name = m[2];
		this.first_episode = m[3];

		try {
			fs.mkdirSync(SAVE_DIR + this.show_name);
		} catch (e) {}

		this.startBrowser()
			.then(() => this.loadPage(this.start_url))
			.then(() => this.getEncryptedPlayerURL()) // acts as the 5 second waiter
			.then(() => this.getEpisodesList())
			.then(() => Promise.delay(SLEEP_TIME))
			.then(() => this.stopBrowser())

			/**/
			.then(() => this.getAllEpisodes())
			.then(console.log)
			.catch(console.err)

			.then(() => this.stopBrowser())
			.then(() => Promise.delay(SLEEP_TIME))
			.then(() => process.exit())
			/**/
		;
	}

	async startBrowser() {
		this.chrome = await launchChrome();
		this.protocol = await CDP({port: this.chrome.port});

		// Extract the DevTools protocol domains we need and enable them.
		// See API docs: https://chromedevtools.github.io/devtools-protocol/
		this.Page = this.protocol.Page;
		this.Runtime = this.protocol.Runtime;

		return Promise.all([
			this.Page.enable(),
			this.Runtime.enable()
		]);
	}

	stopBrowser() {
		this.protocol.close();
		this.chrome.kill();
	}

	async loadPage(url) {
		return new Promise((resolve, reject) => {
			this.Page.navigate({url});
			this.Page.loadEventFired(resolve); // TODO: handle failure
		});
	}

	async getEpisodesList() {
		console.log('getEpisodesList()');

		let idx;
		const res = await this.Runtime.evaluate({expression: `JSON.stringify([...document.querySelectorAll('#selectEpisode option')].map(el => el.value))`});

		this.episode_urls = JSON.parse(res.result.value);
		idx = this.episode_urls.indexOf(this.first_episode);
		if (idx > 0) this.episode_urls.splice(0, idx);
		this.episode_urls = this.episode_urls.map(id => `${this.base_url}${id}`);

		console.log(`Episodes urls (${this.episode_urls.length} entries):\n` + this.episode_urls.join('\n'));
	}

	async getAllEpisodes() {
		console.log('getAllEpisodes()');

		return Promise.mapSeries(
			this.episode_urls,
			url => this.getMediaFor(url)
		);
	}

	async getMediaFor(page_url) {
		console.log(`getMediaFor( ${page_url} )`);

		fs.writeFileSync(path.join(__dirname, CHECKPOINT), page_url); // we update checkpoint now

		return this.startBrowser()
			.then(() => this.loadPage(page_url))
			.then(() => this.getEncryptedPlayerURL())
			.then(url => this.getPlayerUrl(url))
			.then(url => this.getMediaUrl(url))
			.then(url => { this.stopBrowser(); return url })
			.then(url => this.fetchMedia(url, page_url)) // long task!
	}

	async getEncryptedPlayerURL() {
		console.log('getEncryptedPlayerURL()');

		let
			max_wait_for_full_page = 200,
			self = this;

		return new Promise(function(resolve, reject) {
			waitForEncryptedPlayerURL();

			async function waitForEncryptedPlayerURL() {
				if (--max_wait_for_full_page < 0) {
					reject(new Error('Cannot get Full Page', 1));
					return;
				}

				try {
					const res = await self.Runtime.evaluate({expression: "document.querySelector('#centerDivVideo script').textContent"});
					const m = res.result.value.match(/kissenc\.decrypt\(['"]([^)]+)['"]\)/i);
					if (!m || !m[1]) throw new Error('Cannot find encrypted source', 2);
					resolve(m[1]);
				}
				catch(e)
				{
					setTimeout(waitForEncryptedPlayerURL, 100);
				}
			}
		});
	}

	async getPlayerUrl(encrypted_player_url) {
		console.log(`getPlayerUrl( ${encrypted_player_url} )`);
		const res = await this.Runtime.evaluate({expression: `$kissenc.decrypt('${encrypted_player_url}')`});
		return res.result.value;
	}

	async getMediaUrl(player_url) {
		return new Promise((resolve, reject) => {
			let tries_left = 3, err_msg;

			tryNow();

			function tryNow(err) {
				if (err) console.error(err.message);

				console.log(`getMediaUrl( ${player_url} )`);

				if (tries_left-- <= 0) {
					reject(err);
					return;
				}

				request(player_url, (err, resp, body) => {
					if (err) tryNow(err);

					console.log(`received response ${resp.statusCode}`);

					let m = body.match(/<a href="([^"]+q=(\d+p))">/g);
					if (!m) {
						console.error(body);
						return tryNow(new Error('Unable to find multiple player sizes', 3));
					}

					let large_media_player_url = m.pop().split('"')[1];

					console.log(`getMediaUrl( ${large_media_player_url} )`);

					request(large_media_player_url, (err, resp, body) => {
						if (err) return tryNow(err);

						let m = body.match(/source src="([^"]+)".+title="(\d+)p" data-res="(\d+)"/);
						if (!m) return tryNow(new Error('Unable to find player Url', 4));

						resolve(m[1]);
					});
				});
			}
		});
	}

	async fetchMedia(media_url, page_url) {
		console.log(`fetchMedia( ${media_url}, ${page_url} )`);

		return new Promise((resolve, reject) => {
			let
				extension = media_url.split('.').pop(),
				episode_num = page_url.match(KAR_URL_RE)[4],
				start_ms = Date.now(),
				target_filename;

			episode_num = episode_num.split('-').map(num => (num.length < 2 ? `0${num}` : num)).join('-');

			target_filename = `${SAVE_DIR}${this.show_name}/${this.show_name}_S01E${episode_num}.${extension}`;

			console.log(`Fetching ${media_url} into ${target_filename}`);

			request
				.get(media_url)
				.on('error', e => {
					fs.unlinkSync(target_filename);
					console.error(e);
					reject(e);
				})
				.on('end', () => {
					console.log(`Download complete: ${JSON.stringify(parseMs(Date.now() - start_ms))}`);
					resolve();
				})
				.pipe(
					fs.createWriteStream(target_filename)
				)
		});
	}
}

// let's go!
new KissAsianRipper( process.argv[2] );

/**
 * Launches a debugging instance of Chrome.
 * @param {boolean=} headless True (default) launches Chrome in headless mode.
 *     False launches a full version of Chrome.
 * @return {Promise<ChromeLauncher>}
 */
function launchChrome(headless=true) {
  return chromeLauncher.launch({
    // port: 9222, // Uncomment to force a specific port of your choice.
    chromeFlags: [
      '--window-size=1280,720',
      '--disable-gpu',
      headless ? '--headless' : ''
    ]
  });
}
