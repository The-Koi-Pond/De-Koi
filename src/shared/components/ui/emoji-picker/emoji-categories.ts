// The eight emoji categories, in tab order. Each list is whitespace-separated, in the order the grid shows it.

export interface EmojiCategory {
  label: string;
  icon: string;
  emojis: readonly string[];
}

function category(label: string, icon: string, emojis: string): EmojiCategory {
  return { label, icon, emojis: emojis.trim().split(/\s+/) };
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  category(
    "Smileys",
    "😀",
    `
    😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😊 😇 🥰 😍 🤩 😘 😗
    😚 😙 🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🤫 🤔 🫡 🤐
    🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷
    🤒 🤕 🤢 🤮 🥴 😵 🤯 🥳 🥺 😢 😭 😤 😠 😡 🤬 😈
    👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 🤖 😺 😸 😹 😻 😼 😽
    🙀 😿 😾
  `,
  ),
  category(
    "Gestures",
    "👋",
    `
    👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴 👌 🤌 🤏 ✌️ 🤞 🫰 🤟
    🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏
    🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💪 🦾 🦿 🦵 🦶 👂 🦻 👃 🧠
    🫀 🫁 🦷 🦴 👀 👁️ 👅 👄
  `,
  ),
  category(
    "People",
    "👤",
    `
    👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 💂 👷 🫅 🤴
    👸 👳 🧕 🤵 👰 🤰 🫃 🤱 👼 🎅 🤶 🦸 🦹 🧙 🧚 🧛
    🧜 🧝 🧞 🧟 🧌 💆 💇 🚶 🧍 🧎 🏃 💃 🕺 🕴️ 👯 🧖
    🧗 🏌️ 🏄 🚣 🏊 ⛹️ 🏋️ 🚴 🚵 🤸 🤼 🤽 🤾 🤺 ⛷️ 🏂
    🏇
  `,
  ),
  category(
    "Hearts",
    "❤️",
    `
    ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓
    💗 💖 💘 💝 💟 ♥️ 🫶 💑 💏 👪 👨‍👩‍👦 👨‍👩‍👧
  `,
  ),
  category(
    "Nature",
    "🌸",
    `
    🌸 💐 🌷 🌹 🥀 🌺 🌻 🌼 🌱 🪴 🌲 🌳 🌴 🌵 🌾 🌿
    ☘️ 🍀 🍁 🍂 🍃 🍄 🪹 🪺 🐾 🐵 🐒 🦍 🦧 🐶 🐕 🦮
    🐩 🐺 🦊 🦝 🐱 🐈 🦁 🐯 🐅 🐆 🐴 🫎 🫏 🦄 🦓 🐮
    🐂 🐃 🐄 🐷 🐖 🐗 🐽 🐏 🐑 🐐 🐪 🐫 🦙 🦒 🐘 🦣
    🦏 🦛 🐭 🐁 🐀 🐹 🐰 🐇 🐿️ 🦫 🦔 🦇 🐻 🐨 🐼 🦥
    🦦 🦨 🦘 🦡
  `,
  ),
  category(
    "Food",
    "🍕",
    `
    🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥
    🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠
    🫘 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖
    🌭 🍔 🍟 🍕 🫓 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘 🫕 🥫 🍝
    🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡
    🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🧂 🥤 🧋 🫙
    🧃 🥛 🍼 ☕ 🫖 🍵 🍶 🍺 🍻 🥂 🍷 🫗 🥃 🍸 🍹 🍾
    🧊
  `,
  ),
  category(
    "Objects",
    "💡",
    `
    ⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 🖲️ 💽 💾 💿 📀 🧮 📷 📸 📹
    🎥 📞 ☎️ 📺 📻 🎙️ ⏱️ ⏲️ ⏰ 🕰️ 🔮 🧿 🪬 💎 ⚖️ 🔧
    🔨 ⚒️ 🛠️ 🗡️ ⚔️ 🔫 🏹 🛡️ 🪃 🪚 🔩 🪝 🧲 💡 🔦 🕯️
    📔 📕 📖 📗 📘 📙 📚 📓 📒 📃 📜 📄 📰 🗞️ ✂️ 📌
    📍 🖊️ 🖋️ ✒️ 📝 ✏️ 🔎 🔏 🔐 🔑 🗝️
  `,
  ),
  category(
    "Symbols",
    "💯",
    `
    ❤️ 💯 💢 💥 💫 💦 💨 🕳️ 💣 💬 👁️‍🗨️ 🗨️ 🗯️ 💭 💤 🔥
    ✨ 🌟 ⭐ 🌈 ☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ 🌪️ 🌫️ 🌬️
    ❄️ ☃️ ⛄ 💧 🌊 ♠️ ♥️ ♦️ ♣️ 🎯 🎵 🎶 🔴 🟠 🟡 🟢
    🔵 🟣 ⚫ ⚪ 🟤 ✅ ❌ ⭕ ❓ ❗ ‼️ ⁉️ 0️⃣ 1️⃣ 2️⃣ 3️⃣
    4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ 🔤 🔡 🔠 🔣 🅰️ 🅱️
    🆎 🆑 🆒 🆓 🆔 🆕 🆖 🆗 🆘 🆙 🆚 🈁 🈂️ ㊗️ ㊙️ 🈲
    🈳 🈴 🈵 🈶 🈷️ 🈸 🈹 🈺 🉐 🉑 ✔️ ☑️ ⬛ ⬜ ◼️ ◻️
    ◾ ◽ ▪️ ▫️ 🔶 🔷 🔸 🔹 🔺 🔻
  `,
  ),
];
