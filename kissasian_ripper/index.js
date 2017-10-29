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
const TRIES_PER_STEP = 3;

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
			.then(() => this.waitForEpisodeList()) // acts as the 5 second waiter
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

		return this.episode_urls;
	}

	async waitForEpisodeList() {
		console.log('waitForEpisodeList()');

		let
			max_wait_for_episode_list = 200,
			self = this;

		return new Promise(function(resolve, reject) {
			_waitForEpisodeList();

			async function _waitForEpisodeList(e) {
				if (--max_wait_for_episode_list < 0) {
					reject(e);
					return;
				}

				try {
					const res = await self.Runtime.evaluate({expression: `document.querySelectorAll('#selectEpisode option').length`});
					if (res.result.value <= 0) throw new Error('Episode List Not Ready');
					resolve();
				}
				catch(e)
				{
					setTimeout(_waitForEpisodeList, 100, e);
				}
			}
		});
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
			.then(() => this.waitForEpisodeList())
			.then(url => this.getMediaUrl(url))
			.then(url => { this.stopBrowser(); return url })
			.then(url => this.fetchMedia(url, page_url)) // long task!
	}

	async getMediaUrl(player_url) {
		console.log(`getMediaUrl()`);

		let res, encrypted, selection;
		res = await this.Runtime.evaluate({expression: `JSON.stringify([...document.querySelectorAll('#selectQuality option')].map(el => {return {text: el.textContent, value: el.value}}))`});

		let data = JSON.parse(res.result.value);

		data.forEach(el => {
			let m = el.text.match(/^(\d+)p$/);
			if (!m) throw new Error(`Unexpected label format for quality option: ${el.text}`);
			el.size = parseInt(m[1]);
		});

		selection = data.sort((a, b) => b.size - a.size)[0];

		encrypted = selection.value; // sort highest res first

		res = await this.Runtime.evaluate({expression: `$kissenc.decrypt('${encrypted}')`});

		console.log(`Found ${selection.text} media at url "${res.result.value}"`);

		return res.result.value;
	}

	async fetchMedia(media_url, page_url) {
		return new Promise((resolve, reject) => {
			const self = this;
			const MAX_TIME_NO_DATA = 5 * 60 * 1000;
			let tries_left = TRIES_PER_STEP;
			let write_stream, abort_timeout, req, start_ms;

			tryNow();

			function tryNow(err) {
				if (err) console.error(err.message);

				if (tries_left-- <= 0) {
					reject(err);
					return;
				}

				console.log(`fetchMedia( ${media_url}, ${page_url} )`);

				let
					episode_num = page_url.match(KAR_URL_RE)[4],
					target_filename;

				episode_num     = episode_num.split('-').map(num => (num.length < 2 ? `0${num}` : num)).join('-');
				target_filename = `${SAVE_DIR}${self.show_name}/${self.show_name}_S01E${episode_num}.mp4`;
				write_stream    = fs.createWriteStream(target_filename);

				console.log(`Fetching ${media_url} into ${target_filename}`);

				start_ms = Date.now();
				req = request
					.get(media_url)
					.on('error', onError)
					.on('data', onData)
					.on('end', onEnd)
					.pipe(write_stream);

				// fake onData to start the data timeout timer
				onData();
			}

			function onData() {
				abort_timeout = clearTimeout(abort_timeout);
				abort_timeout = setTimeout(abort, MAX_TIME_NO_DATA);
			}

			function onError(e) {
				req.removeAllListeners();
				write_stream.end();
				fs.unlinkSync(target_filename);
				tryNow(e);
			}

			function onEnd(e) {
				if (e) return;
				abort_timeout = clearTimeout(abort_timeout);
				console.log(`Download complete: ${JSON.stringify(parseMs(Date.now() - start_ms))}`);
				resolve();
			}

			function abort() {
				req.abort();
				onError(new Error('No Data Timeout'));
			}
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
