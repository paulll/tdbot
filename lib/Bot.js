const {Client} = require('tdl');
const EventEmitter = require('eventemitter2');
const crypto = require('crypto');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('base64').slice(0,8);

require("util").inspect.defaultOptions.depth = null;


class Bot extends EventEmitter {
	constructor(apiId, apiHash, token, {system_language_code='en',application_version='0.1', device_model='tdbot', system_version='nodejs', use_test_dc=true}) {
		super();

		/**
		 * Диалог - Ожидание ответа от собеседника
		 * Ответ поступает непосредственно в обработчик,
		 * событие `message` не создается
		 *
		 * @short Таблица сопоставления диалогов и обработчиков
		 * @type {Map<user_id, Function<message>>}
		 * @private
		 */
		this._dialogs = new Map;

		/**
		 * Загрузки
		 *
		 * @short Таблица сопосталения файлов и обработчиков
		 * @type {Map<file_id, function<file.local>>}
		 * @private
		 */
		this._downloads = new Map;

		this._callbackQueryListeners = new Map;

		/**
		 * Экземпляр клиента API телеграм
		 *
		 * @type {Client}
		 * @private
		 */
		this._client = new Client({
			apiId, apiHash, loginDetails: {type: 'bot', token},
			tdlibParameters: {
				use_message_database: false,
				use_secret_chats: false,
				enable_storage_optimizer: true,
				use_test_dc,
				system_language_code,
				application_version,
				device_model,
				system_version
			}
		});

		this._client.on('update', (msg) => {
			//console.log(msg);
			this.emit(msg._, msg);
		});

		this.on('updateFile', (upd) => {
			if (!upd.file.local.is_downloading_completed) return;
			if (!this._downloads.has(upd.file.id)) return;
			this._downloads.get(upd.file.id)(upd.file.local);
		});

		this.on('updateNewMessage', (msg) => {
			if (msg.message.is_outgoing) return;
			console.log('INCOMING:', msg.message);
			if (this._dialogs.has(msg.message.chat_id)) {
				this._dialogs.get(msg.message.chat_id)(msg.message);
			}  else {
				this.emit('message', msg.message);
			}
		});

		this.on('updateNewCallbackQuery', async (upd) => {
			if (this._callbackQueryListeners.get(upd.chat_id))
				return this._callbackQueryListeners.get(upd.chat_id)(upd);
			await this._answerCallbackQuery(upd.id, 'Ошибка. Кнопка испортилась, давайте заново');
		})
	}

	//
	// STATIC
	//

	/**
	 * Создает клавиатуру из матрицы,
	 * возвращает соответствующую форму ответа
	 *
	 * @param rows: Array<Array<string>>
	 * @option one_time=true: bool
	 * @returns {{_: string, rows: *, one_time: boolean, resize_keyboard: boolean}}
	 */
	static buttonsKeyboard (rows, one_time=true) {
		return {
			_: 'replyMarkupShowKeyboard',
			rows: rows.map(x=>x.map(y=>({_: 'keyboardButton', type: {_: 'keyboardButtonTypeText'}, text: y}))),
			one_time,
			resize_keyboard: true
		}
	}

	/**
	 * Создает инлайн-клавиатуру из матрицы,
	 * возвращает соответствующую форму ответа
	 *
	 * @param rows: Array<Array<string>>
	 * @returns {{_: string, rows: *}}
	 */
	static buttonsInlineKeyboard (rows) {
		return {
			_: 'replyMarkupInlineKeyboard',
			rows: rows.map(x=>x.map(([y,d])=>({_: 'inlineKeyboardButton', type: {_: 'inlineKeyboardButtonTypeCallback', data: sha256(d).slice(0,8)}, text: y})))
		}
	}

	static get BOOL_KEYBOARD () { return Bot.buttonsKeyboard([['Да'], ['Нет']]) }
	static get NO_KEYBOARD () { return {_: 'replyMarkupHideKeyboard'}; }

	//
	// PROTOTYPE
	//

	/**
	 * Скачивает файл на локальный носитель
	 *
	 * @param file: file
	 * @returns {Promise<string>} путь к локальному файлу
	 */
	async downloadFile (file) {
		this._client.invoke({
			_: 'downloadFile',
			file_id: file.id,
			priority: 16
		});
		return await (new Promise((f) => {
			this._downloads.set(file.id, (local) => {
				this._downloads.delete(file.id);
				f(local.path);
			});
		}));
	}

	/**
	 * Отправляет сообщение и ждет потверждения отправки
	 *
	 * @param msg: {chat_id} - Сообщение из диалога или любой объект с полем chat_id
	 * @param text: string - Текст сообщения
	 * @param markup: markup - Форма ответа
	 * @returns {Promise<void>}
	 */
	async send (msg, text, markup) {
		return await this._sendText(msg, text, markup);
	}

	/**
	 * Отправляет сообщение и ждет ответа
	 *
	 * @param msg {chat_id} - Сообщение из диалога или любой объект с полем chat_id
	 * @param text string - Текст сообщения
	 * @returns {Promise<MessageContent>} - Ответное сообщение
	 */
	async answerAny (msg, text) {
		await this.send(msg, text);
		const answer = await this._awaitMessage(msg);
		return answer.content;
	}

	/**
	 * Отправляет сообщение и ждет ответа в текстовом виде
	 *
	 * @param msg: {chat_id} - Сообщение из диалога или любой объект с полем chat_id
	 * @param text: string - Текст сообщения
	 * @param markup: markup - Форма ответа
	 * @returns {Promise<string>} - Текст ответного сообщения
	 */
	async answerText (msg, text, markup) {
		await this.send(msg, text, markup);
		const answer = await this._awaitMessage(msg);
		if (markup && markup._ === 'replyMarkupShowKeyboard') {
			if (answer.content._ !== '' && markup.rows.every(x => x.every(y => y.text !== answer.content.text.text))) {
				return await this.answerText(msg, 'Ожидался ответ с клавиатуры', markup);
			}
		}
		return answer.content.text.text;
	}

	/**
	 * Предлагает выбрать элементы из списка
	 *
	 * @param msg: {chat_id} - Сообщение из диалога или любой объект с полем chat_id
	 * @param text: string - Текст сообщения
	 * @param list: Array<string> - Варианты ответа
	 * @returns {Promise<Array<string>>}
	 */
	async selectList (msg, text, list) {
		const END_SELECTION = '(завершить)';

		const sel = new Set;
		const kb = () => list.map(x=>[[`${sel.has(x)?'✔':'▫'} ${x}`, x]]).concat([[[END_SELECTION, END_SELECTION]]]);

		await this.send(msg, text, Bot.buttonsInlineKeyboard(kb()));
		//``
		for(;;) {
			const callback = await this._awaitCallbackQuery(msg);

			if (callback.payload.data === sha256(END_SELECTION)) {
				await this._answerCallbackQuery(callback.id, "Хорошо");
				break;
			}

			for (let item of list) {
				if(callback.payload.data === sha256(item)) {
					console.log('FF');
					if (sel.has(item))
						sel.delete(item);
					else
						sel.add(item);
				}
			}

			await this._answerCallbackQuery(callback.id, "Принято!");
			await this._editMesageReplyMarkup(msg, callback.message_id, Bot.buttonsInlineKeyboard(kb()));
		}

		return Array.from(sel);
	}

	/**
	 *
	 * @param msg
	 * @param text
	 * @param list
	 * @returns {Promise<any[]>}
	 */
	async sortList (msg, text, list) {
		const END_SELECTION = '(завершить)';

		const sel = new Set;
		const kb = () => list.map(x=>[[`${sel.has(x)?'✔':'▫'} ${x}`, x]]).concat([[[END_SELECTION, END_SELECTION]]]);

		await this.send(msg, text, Bot.buttonsInlineKeyboard(kb()));

		for(;;) {
			const callback = await this._awaitCallbackQuery(msg);

			if (callback.payload.data === sha256(END_SELECTION)) {
				await this._answerCallbackQuery(callback.id, "Хорошо");
				break;
			}

			for (let item of list) {
				if(callback.payload.data === sha256(item)) {
					console.log('FF');
					if (sel.has(item))
						sel.delete(item);
					else
						sel.add(item);
				}
			}

			await this._answerCallbackQuery(callback.id, "Принято!");
			await this._editMesageReplyMarkup(msg, callback.message_id, Bot.buttonsInlineKeyboard(kb()));
		}

		return Array.from(sel);
	}

	/**
	 * Подключается к Telegram DC
	 *
	 * @returns {Promise<void>}
	 */
	async connect () {return await this._client.connect(); }


	//
	// PRIVATE
	//


	/**
	 * Отправляет текстовое сообщение
	 *
	 * @param msg: {chat_id} - Сообщение из диалога или любой объект с полем chat_id
	 * @param text: string - Текст сообщения
	 * @param markup: markup  - Форма ответа
	 * @returns {Promise<void>}
	 * @private
	 */
	async _sendText (msg, text, markup) {
		console.dir(markup, {deph: null});
		return await this._client.invoke({
			_: 'sendMessage',
			chat_id: msg.chat_id,
			random_id: Math.floor(Math.random() * 2**31),
			input_message_content: {
				_: 'inputMessageText',
				text: {_: 'formattedText', text}
			},
			reply_markup: markup
		});
	}

	/**
	 * Ожидает следующее сообщение в заданном диалоге
	 *
	 * @param msg: {chat_id} - Сообщение из диалога или любой объект с полем chat_id
	 * @returns {Promise<message>}
	 * @private
	 */
	async _awaitMessage(msg) {
		return await new Promise((f) => {
			this._dialogs.set(msg.chat_id, (message) => {
				this._dialogs.delete(msg.chat_id);
				f(message);
			});
		});
	}

	/**
	 * Изменяет форму ответа сообщения
	 *
	 * @param msg: {chat_id} - Сообщение из диалога или любой объект с полем chat_id
	 * @param mid: number- id сообщения
	 * @param markup: markup  - Форма ответа
	 * @returns {Promise<void>}
	 * @private
	 */
	async _editMesageReplyMarkup (msg, mid, markup) {
		return await this._client.invoke({
			_: 'editMessageReplyMarkup',
			chat_id: msg.chat_id,
			message_id: mid,
			reply_markup: markup
		});
	}

	async _answerCallbackQuery(callback_query_id, text) {
		return await this._client.invoke({
			_: 'answerCallbackQuery',
			text,
			callback_query_id
		});
	}

	async _awaitCallbackQuery(msg) {
		return new Promise(f => {
			this._callbackQueryListeners.set(msg.chat_id, (upd) => {
				this._callbackQueryListeners.delete(msg.chat_id);
				f(upd);
			});
		})
	}

	async deleteMessage(msg) {
		return await this._client.invoke({
			_: 'deleteMessages',
			chat_id: msg.chat_id,
			message_ids: [msg.id],
			revoke: true
		});
	}

	async sendAudio(msg, audio, {title, performer, caption}) {
		return await this._client.invoke({
			_: 'sendMessage',
			chat_id: msg.chat_id,
			random_id: Math.floor(Math.random() * 2**31),
			input_message_content: {
				_: 'inputMessageAudio',
				audio: {
					_: 'inputFileLocal',
					path: audio
				},
				//album_cover_thumbnail: {
				//	_: 'inputThumbnail',
				//	width: 0,
				//	height: 0,
				//	thumbnail: {
				//		_: 'inputFileLocal',
				//		path: thumbnail
				//	}
				//},
				title, performer, caption: {_: 'formattedText', text: caption}
			}
		});
	}
}

exports.Bot = Bot;