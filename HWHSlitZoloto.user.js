// ==UserScript==
// @name         HWH Слить золото (Дар стихий / Аврора)
// @namespace    HWHSlitZoloto
// @version      0.9
// @description  Добавляет в меню "Действия" HeroWarsHelper кнопки "Слить золото" (Дар стихий Авроры пакетами, N циклов, в конце дар остаётся на 30 уровне) и "Невидимый магазин". Добавлена кнопка "Закрыть" в окно результатов.
// @match        https://www.hero-wars.com/*
// @match        https://www.hero-wars.cn/*
// @match        https://apps-1701433570146040.apps.fbsbx.com/*
// @run-at       document-end
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/emz13666/HWHSlitZoloto/main/HWHSlitZoloto.user.js
// @updateURL    https://raw.githubusercontent.com/emz13666/HWHSlitZoloto/main/HWHSlitZoloto.user.js
// ==/UserScript==
/**
* Требует установленный и работающий HeroWarsHelper (v2.460+):
* используются его глобальные объекты HWHData, Caller, cheats.
*
* Игровые вызовы:
*   heroTitanGiftLevelUp { heroId } - активировать / улучшить Дар стихий
*   heroTitanGiftDrop    { heroId } - сбросить Дар стихий
*   shopBuy { shopId: 18, slot: 1 } - покупка в невидимом магазине
*/
(function () {
'use strict';

/* ================================================================ */
/* 🔥 ПРОВЕРКА ГОТОВНОСТИ RUNTIME HWH (из bootstrap.ts)           */
/* ================================================================ */
function isHwhRuntimeReady(requiredKeys = ["HWHClasses", "HWHFuncs", "HWHData"], readyWhen) {
    const runtimeRoot = globalThis;
    if (!requiredKeys.every((key) => !!runtimeRoot[key])) return false;
    if (!readyWhen) return true;
    try {
        return readyWhen();
    } catch {
        return false;
    }
}

function retryHwhRuntimeInitialization({
    attempt = 0,
    maxAttempts = 120,
    delayMs = 500,
    requiredKeys = ["HWHClasses", "HWHFuncs", "HWHData"],
    retry,
    readyWhen,
    logPrefix = "[HWH SlitZoloto]",
    scriptName = "HWH Слить золото",
    showInstallNotice = true,
} = {}) {
    const initAttempt = Number(attempt) || 0;
    if (isHwhRuntimeReady(requiredKeys, readyWhen)) {
        return true;
    }
    if (initAttempt < maxAttempts && typeof retry === "function") {
        globalThis.setTimeout(() => retry(initAttempt + 1), delayMs);
        return false;
    }
    console.log(`%c${logPrefix} Объект расширения не найден`, "color: red");
    if (showInstallNotice) {
        alert(`${scriptName}: Не найден HeroWarsHelper. Убедитесь, что он установлен и загружен.`);
    }
    return false;
}

/* ================================================================ */
/* КОНСТАНТЫ                                                        */
/* ================================================================ */
const GOLD_PER_CYCLE = 7927500; // золото за один цикл 0 -> 30
const MAX_LEVEL = 30;
const PAUSE_MS = 100;
const SHOP_ID = 18; // "невидимый магазин"
const SHOP_SLOT = 1;
const SHOP_PRICE = 3000000; // золото за одну покупку
const SHOP_PAUSE_MS = 200;
const HERO_NAME_RE = /аврор|aurora/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Number(n).toLocaleString('ru-RU');

/* ================================================================ */
/* 🔥 Вспомогательная функция: формирование пакета из 30 вызовов  */
/* ================================================================ */
function buildGiftLevelUpPack(heroId) {
    const calls = [];
    for (let i = 0; i < MAX_LEVEL; i++) {
        calls.push({ name: 'heroTitanGiftLevelUp', args: { heroId } });
    }
    return calls;
}

/* ================================================================ */
/* Стили                                                            */
/* ================================================================ */
function addStyles() {
    if (document.getElementById('hwsz-style')) return;
    const style = document.createElement('style');
    style.id = 'hwsz-style';
    style.textContent = `
.hwsz-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.6);
display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif}
.hwsz-box{background:#2b2318;border:2px solid #8a6d3b;border-radius:8px;color:#f3e3bd;
padding:18px 22px;min-width:320px;max-width:95vw;box-shadow:0 0 20px #000}
.hwsz-title{font-size:18px;font-weight:bold;margin-bottom:12px;text-align:center}
.hwsz-text{font-size:14px;margin:8px 0;text-align:center;line-height:1.4;white-space:pre-line}
.hwsz-input{width:100%;box-sizing:border-box;font-size:18px;text-align:center;padding:6px;
border:1px solid #8a6d3b;border-radius:4px;background:#1a140d;color:#fff}
.hwsz-gold{font-size:14px;margin-top:10px;text-align:center;color:#ffd24d}
.hwsz-btns{display:flex;gap:8px;margin-top:16px;justify-content:center;flex-wrap: wrap;}
.hwsz-btn{flex:1 1 auto;padding:6px 10px;font-size:13px;font-weight:bold;border-radius:4px;
border:1px solid #000;cursor:pointer;color:#fff; min-width: 80px; white-space: nowrap;}
.hwsz-btn.green{background:#3d8f2f}.hwsz-btn.red{background:#a8322b}
.hwsz-btn.blue{background:#2f6fa8}
.hwsz-btn:hover{filter:brightness(1.15)}
.hwsz-btn:disabled{opacity:.6;cursor:default}
.hwsz-bar{height:14px;background:#1a140d;border:1px solid #8a6d3b;border-radius:7px;overflow:hidden;margin-top:8px}
.hwsz-bar>div{height:100%;width:0;background:#3d8f2f;transition:width .15s}
.hwsz-err{color:#ff8a80}
`;
    document.head.appendChild(style);
}

/* ================================================================ */
/* Модальное окно                                                   */
/* ================================================================ */
let overlay = null;
function openModal() {
    addStyles();
    closeModal();
    overlay = document.createElement('div');
    overlay.className = 'hwsz-overlay';
    ['keydown', 'keyup', 'keypress'].forEach((ev) => overlay.addEventListener(ev, (e) => e.stopPropagation()));
    document.body.appendChild(overlay);
    return overlay;
}
function closeModal() {
    if (overlay) {
        overlay.remove();
        overlay = null;
    }
}
function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}
function button(text, color, onClick) {
    const b = el('button', 'hwsz-btn ' + color, text);
    b.addEventListener('click', onClick);
    return b;
}
function render(...children) {
    const box = el('div', 'hwsz-box');
    children.forEach((c) => box.appendChild(c));
    overlay.replaceChildren(box);
    return box;
}

/* ================================================================ */
/* Экран 1: запрос количества циклов                                */
/* ================================================================ */
function showCountInput({ title, text, unitCost, defaultValue, onSubmit }) {
    openModal();
    const input = el('input', 'hwsz-input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.value = String(defaultValue);
    const gold = el('div', 'hwsz-gold');
    const updateGold = () => {
        const n = Math.floor(+input.value) || 0;
        gold.textContent = `Золота к трате: ${fmt(Math.max(n, 0) * unitCost)}`;
    };
    input.addEventListener('input', updateGold);
    updateGold();
    const submit = () => {
        const n = Math.floor(+input.value);
        if (!n || n < 1) {
            input.focus();
            return;
        }
        onSubmit(n);
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') closeModal();
    });
    const row = el('div', 'hwsz-btns');
    row.append(button('ОК', 'green', submit), button('Отмена', 'red', closeModal));
    render(el('div', 'hwsz-title', title), el('div', 'hwsz-text', text), input, gold, row);
    input.focus();
    input.select();
}
function showInput(defaultValue = 1) {
    showCountInput({
        title: 'Слить золото',
        text: 'Количество циклов\n(Аврора: сброс дара → пакет 0→30)\nПосле последнего цикла дар остаётся на 30 уровне',
        unitCost: GOLD_PER_CYCLE,
        defaultValue,
        onSubmit: startRun,
    });
}
function showShopInput(defaultValue = 1) {
    showCountInput({
        title: 'Невидимый магазин',
        text: 'Количество невидимых покупок',
        unitCost: SHOP_PRICE,
        defaultValue,
        onSubmit: startShop,
    });
}

/* ================================================================ */
/* Экран 2: выполнение                                              */
/* ================================================================ */
async function findAurora() {
    const heroes = await Caller.send('heroGetAll');
    for (const hero of Object.values(heroes)) {
        let name = '';
        try {
            name = cheats.translate('LIB_HERO_NAME_' + hero.id) || '';
        } catch (e) {}
        if (HERO_NAME_RE.test(name)) return hero;
    }
    return null;
}

async function startRun(cycles) {
    const state = { stop: false };
    const info = el('div', 'hwsz-text', 'Подготовка...');
    const barInner = el('div');
    const bar = el('div', 'hwsz-bar');
    bar.appendChild(barInner);
    const stopBtn = button('Остановить', 'red', () => {
        state.stop = true;
        stopBtn.disabled = true;
        stopBtn.textContent = 'Останавливаю...';
    });
    const row = el('div', 'hwsz-btns');
    row.appendChild(stopBtn);
    render(el('div', 'hwsz-title', 'Слив золота (пакетами)...'), info, bar, row);

    let doneCycles = 0;
    let error = null;
    let heroId = 0;
    let level = 0;

    try {
        const aurora = await findAurora();
        if (!aurora) throw new Error('Герой Аврора не найден (проверь, что она есть в аккаунте).');
        heroId = aurora.id;
        level = aurora.titanGiftLevel || 0;

        for (let c = 1; c <= cycles && !state.stop; c++) {
            if (level > 0) {
                info.textContent = `Цикл ${c} / ${cycles}\nСброс дара (ур. ${level})...`;
                try {
                    await Caller.send({ name: 'heroTitanGiftDrop', args: { heroId } });
                    level = 0;
                } catch (e) {
                    console.warn('[HWH SlitZoloto] Сброс прерван:', e.message);
                    error = `Сброс в цикле ${c} прерван: ${e.message || e}`;
                    break;
                }
                await sleep(PAUSE_MS);
            }

            info.textContent = `Цикл ${c} / ${cycles}\nПакет из ${MAX_LEVEL} повышений 0 → ${MAX_LEVEL}...`;
            barInner.style.width = `${((c - 1) / cycles) * 100}%`;

            try {
                const calls = buildGiftLevelUpPack(heroId);
                await Caller.send(calls);
                level = MAX_LEVEL;
                doneCycles++;
            } catch (e) {
                console.warn('[HWH SlitZoloto] Цикл прерван:', e.message);
                error = `Цикл ${c} прерван: ${e.message || e}`;
                if (heroId && level > 0) {
                    try { await Caller.send({ name: 'heroTitanGiftDrop', args: { heroId } }); } catch (e2) {}
                }
                level = 0;
                break;
            }

            barInner.style.width = `${(c / cycles) * 100}%`;
            await sleep(PAUSE_MS);
        }
    } catch (e) {
        console.error('[HWH SlitZoloto]', e);
        error = e && e.message ? e.message : String(e);
        if (heroId && level > 0) {
            try {
                await Caller.send({ name: 'heroTitanGiftDrop', args: { heroId } });
            } catch (e2) {}
        }
    }

    showFinish(cycles, doneCycles, state.stop, error, level);
}

/* ================================================================ */
/* Экран 3: итог (Слить золото)                                     */
/* ================================================================ */
function showFinish(cycles, doneCycles, stopped, error, finalLevel) {
    const lines = [
        `Выполнено циклов (слив): ${doneCycles} из ${cycles}`,
        `Потрачено золота на слив: ${fmt(doneCycles * GOLD_PER_CYCLE)}`,
    ];
    
    if (stopped) lines.unshift('Остановлено пользователем.');
    const children = [el('div', 'hwsz-title', error ? 'Ошибка' : stopped ? 'Остановлено' : 'Готово')];
    if (error) children.push(el('div', 'hwsz-text hwsz-err', error));
    children.push(el('div', 'hwsz-text', lines.join('\n')));
    
    const row = el('div', 'hwsz-btns');
    // 🔥 ДОБАВЛЕНА КНОПКА "ЗАКРЫТЬ"
    row.append(
        button('Закрыть', 'red', closeModal),
        button('Перезагрузить', 'blue', () => location.reload()), 
        button('Слить еще', 'green', () => showInput(cycles))
    );
    children.push(row);
    render(...children);
}

/* ================================================================ */
/* Невидимый магазин                                                */
/* ================================================================ */
async function startShop(count) {
    const state = { stop: false };
    const info = el('div', 'hwsz-text', 'Подготовка...');
    const barInner = el('div');
    const bar = el('div', 'hwsz-bar');
    bar.appendChild(barInner);
    const stopBtn = button('Остановить', 'red', () => {
        state.stop = true;
        stopBtn.disabled = true;
        stopBtn.textContent = 'Останавливаю...';
    });
    const row = el('div', 'hwsz-btns');
    row.appendChild(stopBtn);
    render(el('div', 'hwsz-title', 'Невидимые покупки...'), info, bar, row);
    let done = 0;
    let error = null;
    try {
        for (let i = 1; i <= count && !state.stop; i++) {
            info.textContent = `Покупка ${i} / ${count}`;
            await Caller.send({ name: 'shopBuy', args: { shopId: SHOP_ID, slot: SHOP_SLOT } });
            done++;
            barInner.style.width = `${(i / count) * 100}%`;
            await sleep(SHOP_PAUSE_MS);
        }
    } catch (e) {
        console.error('[HWH SlitZoloto]', e);
        error = e && e.message ? e.message : String(e);
    }
    showShopFinish(count, done, state.stop, error);
}

/* ================================================================ */
/* Экран 3: итог (Невидимый магазин)                                */
/* ================================================================ */
function showShopFinish(count, done, stopped, error) {
    const lines = [`Выполнено покупок: ${done} из ${count}`, `Потрачено золота: ${fmt(done * SHOP_PRICE)}`];
    if (stopped) lines.unshift('Остановлено пользователем.');
    const children = [el('div', 'hwsz-title', error ? 'Ошибка' : stopped ? 'Остановлено' : 'Готово')];
    if (error) children.push(el('div', 'hwsz-text hwsz-err', error));
    children.push(el('div', 'hwsz-text', lines.join('\n')));
    
    const row = el('div', 'hwsz-btns');
    // 🔥 ДОБАВЛЕНА КНОПКА "ЗАКРЫТЬ"
    row.append(
        button('Закрыть', 'red', closeModal),
        button('Перезагрузить', 'blue', () => location.reload()), 
        button('Купить еще', 'green', () => showShopInput(count))
    );
    children.push(row);
    render(...children);
}

/* ================================================================ */
/* 🔥 Регистрация кнопки в меню "Действия" HeroWarsHelper          */
/* ================================================================ */
function registerButton() {
    const list = window.HWHData && window.HWHData.actionsPopupButtons;
    if (!list || typeof window.Caller === 'undefined') return false;
    if (list.some((b) => b && b.hwhSlitZoloto)) return true;
    const buttons = [
        {
            hwhSlitZoloto: true,
            msg: 'Слить золото',
            title: 'Прокачка Дара стихий Авроры пакетами, N циклов. После последнего цикла дар остаётся на 30 уровне',
            color: 'orange',
            result() {
                showInput(1);
            },
        },
        {
            hwhSlitZoloto: true,
            msg: 'Невидимый магазин',
            title: 'N невидимых покупок (shopBuy, shopId 18, слот 1)',
            color: 'orange',
            result() {
                showShopInput(1);
            },
        },
    ];
    const closeIdx = list.findIndex((b) => b && b.isClose);
    if (closeIdx === -1) list.push(...buttons);
    else list.splice(closeIdx, 0, ...buttons);
    console.log('[HWH SlitZoloto] кнопки добавлены в "Действия"');
    return true;
}

/* ================================================================ */
/* 🔥 ЗАПУСК С ПРОВЕРКОЙ ГОТОВНОСТИ RUNTIME HWH                   */
/* ================================================================ */
function tryRegister(attempt) {
    const ready = retryHwhRuntimeInitialization({
        attempt,
        maxAttempts: 120,
        delayMs: 500,
        requiredKeys: ["HWHClasses", "HWHFuncs", "HWHData"],
        retry: tryRegister,
        readyWhen: () => {
            return !!(window.HWHData && window.HWHData.actionsPopupButtons && typeof window.Caller !== 'undefined');
        },
        logPrefix: "[HWH SlitZoloto]",
        scriptName: "HWH Слить золото",
        showInstallNotice: true,
    });
    if (ready) {
        registerButton();
    }
}

tryRegister(0);

})();
