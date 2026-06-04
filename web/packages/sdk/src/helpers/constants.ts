export const BASE64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const tempMap = new Int16Array(256).fill(-1);
for (let i = 0; i < BASE64_URL_ALPHABET.length; i++) {
    tempMap[BASE64_URL_ALPHABET.charCodeAt(i)] = i;
}
export const BASE64_URL_MAP = tempMap

