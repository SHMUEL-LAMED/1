// inline-actions.js — מאזינים מואצלים במקום מאזינים בתוך ה-HTML.
//
// מדיניות האבטחה (Content-Security-Policy, ראו index.html) אוסרת קוד בתוך
// מאפיינים כמו onclick="..." — זה בדיוק מה שמאפשר הזרקת סקריפט. לכן כל
// המאפיינים האלה נכתבים כ-data-onclick="..." (וכן data-onchange,
// data-oninput, data-onsubmit, data-onkeydown, data-onerror, data-onload,
// data-ondrop, data-ondragover, data-ondragleave), והקובץ הזה מריץ אותם.
//
// אין כאן eval או new Function: הטקסט מפוענח בידי מפענח קטן שמכיר רק את
// התת-שפה שבה הדפים משתמשים — קריאה לפונקציה גלובלית (window.x / x), גישה
// לשדות (this.value, event.target), ‎?.‎, מחרוזות, מספרים, מערכים ואובייקטים
// פשוטים, ===, !, &&, ||, ?:, if (...) ופקודות מופרדות ב-;. מזהה חופשי נקרא
// מ-window, כמו במאפיין המקורי. this הוא האלמנט שעליו המאפיין, event הוא
// האירוע.
//
// סדר ההרצה מחקה את המקור: באירוע מבעבע (click וכו') המאזין יושב על document
// ונרשם לפני כל מאזין אחר באתר (app.js מייבא את הקובץ ראשון). הוא עובר מהיעד
// כלפי מעלה ומריץ כל data-on* בדרך; stopPropagation בתוך מאזין עוצר את
// ההליכה וגם את שאר מאזיני document, כפי שהיה עוצר את הבעבוע. אירועים שאינם
// מבעבעים (error, load) נתפסים בשלב הלכידה ומורצים רק על היעד עצמו.

const BUBBLING_EVENTS = ['click', 'change', 'input', 'submit', 'keydown', 'drop', 'dragover', 'dragleave'];
const TARGET_ONLY_EVENTS = ['error', 'load'];

// --- מפענח ---

const PUNCTUATORS = ['===', '!==', '?.', '&&', '||', '==', '!=', '(', ')', '[', ']', '{', '}', ',', ';', ':', '.', '!', '?', '-'];

function tokenize(source) {
    const tokens = [];
    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        if (/\s/.test(ch)) { i++; continue; }
        if (ch === '"' || ch === "'" || ch === '`') {
            let value = '';
            i++;
            while (i < source.length && source[i] !== ch) {
                if (source[i] === '\\') {
                    const next = source[i + 1];
                    value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
                    i += 2;
                } else {
                    value += source[i++];
                }
            }
            if (source[i] !== ch) throw new SyntaxError(`מחרוזת לא סגורה: ${source}`);
            i++;
            tokens.push({ type: 'value', value });
            continue;
        }
        const number = /^\d+(?:\.\d+)?/.exec(source.slice(i));
        if (number) {
            tokens.push({ type: 'value', value: Number(number[0]) });
            i += number[0].length;
            continue;
        }
        const word = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
        if (word) {
            tokens.push({ type: 'word', value: word[0] });
            i += word[0].length;
            continue;
        }
        // ‎?.‎ שאחריו ספרה הוא אופרטור ?: ולא שרשור אופציונלי.
        const punct = PUNCTUATORS.find(p => source.startsWith(p, i) && !(p === '?.' && /\d/.test(source[i + 2] || '')));
        if (!punct) throw new SyntaxError(`תו לא נתמך "${ch}" ב: ${source}`);
        tokens.push({ type: 'punct', value: punct });
        i += punct.length;
    }
    return tokens;
}

const LITERAL_WORDS = { true: true, false: false, null: null, undefined: undefined };

export function parseInlineHandler(source) {
    const tokens = tokenize(String(source));
    let pos = 0;
    const peek = (value, offset = 0) => {
        const token = tokens[pos + offset];
        return token && token.type !== 'value' && token.value === value;
    };
    const take = value => {
        if (!peek(value)) throw new SyntaxError(`ציפיתי ל-"${value}" ב: ${source}`);
        pos++;
    };
    const eat = value => (peek(value) ? (pos++, true) : false);

    function statements(stop) {
        const list = [];
        while (pos < tokens.length && !(stop && peek(stop))) {
            if (eat(';')) continue;
            list.push(statement());
        }
        return list;
    }

    function statement() {
        if (peek('if') && tokens[pos].type === 'word') {
            pos++;
            take('(');
            const test = expression();
            take(')');
            const then = eat('{') ? { type: 'block', body: (() => { const b = statements('}'); take('}'); return b; })() } : statement();
            let otherwise = null;
            if (peek('else')) { pos++; otherwise = eat('{') ? { type: 'block', body: (() => { const b = statements('}'); take('}'); return b; })() } : statement(); }
            return { type: 'if', test, then, otherwise };
        }
        if (peek('return') && tokens[pos].type === 'word') {
            pos++;
            const argument = pos < tokens.length && !peek(';') ? expression() : { type: 'literal', value: undefined };
            return { type: 'return', argument };
        }
        return { type: 'expr', expression: expression() };
    }

    function expression() {
        const test = logical();
        if (eat('?')) {
            const consequent = expression();
            take(':');
            return { type: 'conditional', test, consequent, alternate: expression() };
        }
        return test;
    }

    function logical() {
        let left = equality();
        while (peek('&&') || peek('||')) {
            const operator = tokens[pos++].value;
            left = { type: 'logical', operator, left, right: equality() };
        }
        return left;
    }

    function equality() {
        let left = unary();
        while (peek('===') || peek('!==') || peek('==') || peek('!=')) {
            const operator = tokens[pos++].value;
            left = { type: 'binary', operator, left, right: unary() };
        }
        return left;
    }

    function unary() {
        if (eat('!')) return { type: 'not', argument: unary() };
        if (eat('-')) return { type: 'negate', argument: unary() };
        return postfix();
    }

    function postfix() {
        let node = primary();
        for (;;) {
            if (eat('.')) {
                node = { type: 'member', object: node, property: { type: 'literal', value: word() }, optional: false };
            } else if (eat('?.')) {
                if (eat('(')) node = { type: 'call', callee: node, args: args(), optional: true };
                else if (eat('[')) { const property = expression(); take(']'); node = { type: 'member', object: node, property, optional: true }; }
                else node = { type: 'member', object: node, property: { type: 'literal', value: word() }, optional: true };
            } else if (eat('[')) {
                const property = expression();
                take(']');
                node = { type: 'member', object: node, property, optional: false };
            } else if (eat('(')) {
                node = { type: 'call', callee: node, args: args(), optional: false };
            } else {
                return node;
            }
        }
    }

    function word() {
        const token = tokens[pos];
        if (!token || token.type !== 'word') throw new SyntaxError(`ציפיתי לשם ב: ${source}`);
        pos++;
        return token.value;
    }

    function args() {
        const list = [];
        while (!eat(')')) {
            list.push(expression());
            if (!peek(')')) take(',');
        }
        return list;
    }

    function primary() {
        const token = tokens[pos];
        if (!token) throw new SyntaxError(`ביטוי חסר ב: ${source}`);
        if (token.type === 'value') { pos++; return { type: 'literal', value: token.value }; }
        if (token.type === 'word') {
            pos++;
            if (Object.hasOwn(LITERAL_WORDS, token.value)) return { type: 'literal', value: LITERAL_WORDS[token.value] };
            return { type: 'identifier', name: token.value };
        }
        if (eat('(')) { const inner = expression(); take(')'); return inner; }
        if (eat('[')) {
            const elements = [];
            while (!eat(']')) { elements.push(expression()); if (!peek(']')) take(','); }
            return { type: 'array', elements };
        }
        if (eat('{')) {
            const properties = [];
            while (!eat('}')) {
                const keyToken = tokens[pos++];
                if (!keyToken || keyToken.type === 'punct') throw new SyntaxError(`מפתח לא תקין ב: ${source}`);
                take(':');
                properties.push([String(keyToken.value), expression()]);
                if (!peek('}')) take(',');
            }
            return { type: 'object', properties };
        }
        throw new SyntaxError(`ביטוי לא נתמך "${token.value}" ב: ${source}`);
    }

    const body = statements();
    return { type: 'program', body };
}

// --- הרצה ---

const RETURN = Symbol('return');
// בלי דרך אל בנאי הפונקציות או אל שרשרת ה-prototype — המפענח מריץ רק קריאות
// לפונקציות קיימות, ואינו פותח דלת לקוד חדש.
const BLOCKED_PROPERTIES = new Set(['constructor', '__proto__', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);
const OPTIONAL_SHORT_CIRCUIT = Symbol('optional');

function resolveIdentifier(name, scope) {
    if (name === 'this') return scope.self;
    if (name === 'event') return scope.event;
    if (name === 'window') return scope.window;
    if (!(name in scope.window)) throw new ReferenceError(`${name} is not defined`);
    return scope.window[name];
}

// מחזיר { value, thisArg } כדי שקריאה לשיטה (document.getElementById) תקבל
// את האובייקט הנכון כ-this.
function evaluateReference(node, scope) {
    if (node.type === 'member') {
        const object = evaluate(node.object, scope);
        if (object === OPTIONAL_SHORT_CIRCUIT || (node.optional && object == null)) return { value: OPTIONAL_SHORT_CIRCUIT };
        const key = evaluate(node.property, scope);
        if (BLOCKED_PROPERTIES.has(String(key))) throw new TypeError(`גישה ל-${key} חסומה`);
        return { value: object[key], thisArg: object };
    }
    return { value: evaluate(node, scope), thisArg: undefined };
}

function evaluate(node, scope) {
    switch (node.type) {
        case 'literal': return node.value;
        case 'identifier': return resolveIdentifier(node.name, scope);
        case 'array': return node.elements.map(element => evaluate(element, scope));
        case 'object': return Object.fromEntries(node.properties.map(([key, value]) => [key, evaluate(value, scope)]));
        case 'not': return !evaluate(node.argument, scope);
        case 'negate': return -evaluate(node.argument, scope);
        case 'conditional': return evaluate(node.test, scope) ? evaluate(node.consequent, scope) : evaluate(node.alternate, scope);
        case 'logical': {
            const left = evaluate(node.left, scope);
            if (node.operator === '&&') return left ? evaluate(node.right, scope) : left;
            return left ? left : evaluate(node.right, scope);
        }
        case 'binary': {
            const left = evaluate(node.left, scope);
            const right = evaluate(node.right, scope);
            switch (node.operator) {
                case '===': return left === right;
                case '!==': return left !== right;
                // eslint-disable-next-line eqeqeq
                case '==': return left == right;
                // eslint-disable-next-line eqeqeq
                default: return left != right;
            }
        }
        case 'member': {
            const { value } = evaluateReference(node, scope);
            return value;
        }
        case 'call': {
            const { value: callee, thisArg } = evaluateReference(node.callee, scope);
            if (callee === OPTIONAL_SHORT_CIRCUIT) return OPTIONAL_SHORT_CIRCUIT;
            if (node.optional && callee == null) return OPTIONAL_SHORT_CIRCUIT;
            if (typeof callee !== 'function') throw new TypeError(`${describe(node.callee)} is not a function`);
            return callee.apply(thisArg, node.args.map(arg => {
                const value = evaluate(arg, scope);
                return value === OPTIONAL_SHORT_CIRCUIT ? undefined : value;
            }));
        }
        default: throw new Error(`צומת לא מוכר ${node.type}`);
    }
}

function describe(node) {
    if (node.type === 'identifier') return node.name;
    if (node.type === 'member' && node.property.type === 'literal') return `${describe(node.object)}.${node.property.value}`;
    return 'expression';
}

function execute(statements, scope) {
    for (const statement of statements) {
        if (statement.type === 'block') {
            const result = execute(statement.body, scope);
            if (result && result[RETURN]) return result;
        } else if (statement.type === 'if') {
            const branch = evaluate(statement.test, scope) ? statement.then : statement.otherwise;
            if (branch) {
                const result = execute([branch], scope);
                if (result && result[RETURN]) return result;
            }
        } else if (statement.type === 'return') {
            const value = evaluate(statement.argument, scope);
            return { [RETURN]: true, value: value === OPTIONAL_SHORT_CIRCUIT ? undefined : value };
        } else {
            evaluate(statement.expression, scope);
        }
    }
    return null;
}

const parsedCache = new Map();

function compile(source) {
    let program = parsedCache.get(source);
    if (!program) {
        program = parseInlineHandler(source);
        parsedCache.set(source, program);
    }
    return program;
}

// מריץ טקסט מאפיין אחד כפי שהדפדפן היה מריץ onclick="...". מחזיר את ערך
// ה-return (false מבטל את ברירת המחדל, כמו במאפיין המקורי).
export function runInlineHandler(source, { self, event, win = globalThis } = {}) {
    const result = execute(compile(source).body, { self, event, window: win });
    return result ? result.value : undefined;
}

// --- חיבור לדף ---

function invoke(element, type, event) {
    const source = element.getAttribute(`data-on${type}`);
    if (source == null || source === '') return;
    try {
        const returned = runInlineHandler(source, { self: element, event, win: window });
        if (returned === false) event.preventDefault();
    } catch (error) {
        // כמו חריגה במאפיין מקורי: מדווחת כשגיאה שלא נתפסה ואינה עוצרת את השאר.
        setTimeout(() => { throw error; });
    }
}

function handleBubbling(event) {
    let stopped = false;
    const originalStop = event.stopPropagation;
    const originalStopImmediate = event.stopImmediatePropagation;
    event.stopPropagation = function stopPropagation() {
        stopped = true;
        originalStop.call(this);
        // המאזין הזה הוא הראשון על document, ולכן עצירה מיידית כאן מונעת גם
        // את מאזיני document האחרים — כמו שהבעבוע המקורי היה נעצר לפניהם.
        originalStopImmediate.call(this);
    };
    event.stopImmediatePropagation = function stopImmediatePropagation() {
        stopped = true;
        originalStopImmediate.call(this);
    };
    try {
        const path = event.composedPath ? event.composedPath() : [];
        for (const node of path) {
            if (node === document || node === window) break;
            if (node.nodeType !== 1 || !node.hasAttribute(`data-on${event.type}`)) continue;
            invoke(node, event.type, event);
            if (stopped) break;
        }
    } finally {
        event.stopPropagation = originalStop;
        event.stopImmediatePropagation = originalStopImmediate;
    }
}

function handleTargetOnly(event) {
    const target = event.target;
    if (target && target.nodeType === 1 && target.hasAttribute(`data-on${event.type}`)) invoke(target, event.type, event);
}

let installed = false;

export function installInlineActions(doc = globalThis.document) {
    if (installed || !doc) return;
    installed = true;
    for (const type of BUBBLING_EVENTS) doc.addEventListener(type, handleBubbling);
    for (const type of TARGET_ONLY_EVENTS) doc.addEventListener(type, handleTargetOnly, true);
}

if (typeof document !== 'undefined') installInlineActions(document);
