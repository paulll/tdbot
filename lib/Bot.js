const {Client} = require('tdl');
const EventEmitter = require('eventemitter2');

class Bot extends EventEmitter {
	constructor(apiId, apiHash, token, {system_language_code='en',application_version='0.1', device_model='tdbot', system_version='nodejs', use_test_dc=true}) {
		super();

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
			this.emit(msg._, msg);
		});

		this.on('updateNewMessage', (msg) => {
			if (msg.message.is_outgoing) return;
			this.emit('message', msg.message);
		});

		// this.on('updateNewCallbackQuery', async (upd) => { })
	}

	/**
	 * Создает клавиатуру из матрицы,
	 * возвращает соответствующую форму ответа
	 *
	 * @param rows: Array<Array<string>>
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
	 */
	static buttonsInlineKeyboard (rows) {
		return {
			_: 'replyMarkupInlineKeyboard',
			rows: rows.map(x=>x.map(([y,d])=>({_: 'inlineKeyboardButton', type: {_: 'inlineKeyboardButtonTypeCallback', data: sha256(d).slice(0,8)}, text: y})))
		}
	}

	static get BOOL_KEYBOARD () { return Bot.buttonsKeyboard([['Да'], ['Нет']]) }
	static get NO_KEYBOARD () { return {_: 'replyMarkupHideKeyboard'}; }


	/**
	 * Отправляет сообщение и ждет потверждения отправки
	 *
	 * @param msg: {chat_id} - Сообщение из диалога или любой объект с полем chat_id
	 */
	async send (msg, text, markup) {
		return await this._sendText(msg, text, markup);
	}


	/**
	 * Подключается к Telegram DC
	 */
	async connect () {return await this._client.connect(); }

	//
	// PRIVATE
	//
	/**
	 * Отправляет текстовое сообщение
	 *
	 * @param msg: {chat_id} - Сообщение из диалога или любой объект с полем chat_id
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


	async answerCallbackQuery(callback_query_id, text) {
		return await this._client.invoke({
			_: 'answerCallbackQuery',
			text,
			callback_query_id
		});
	}

	async deleteMessage(msg) {
		return await this._client.invoke({
			_: 'deleteMessages',
			chat_id: msg.chat_id,
			message_ids: [msg.id],
			revoke: true
		});
	}
}

exports.Bot = Bot;