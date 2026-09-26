/*
 * Fill Warehouse
 *
 * Run it while viewing an underdeveloped village. It pulls resources from your
 * configured source villages (closest first) until this village's warehouse
 * reaches the configured fill percentage, counting resources already on the way.
 *
 * Every market send is its own button click (one click = one action).
 * Settings are stored per world in localStorage.
 *
 * The panel stays at the top of the page and the game is shown in a frame below it,
 * so changing village (Next/Previous, or any link in the game) keeps the panel.
 */
(function () {
    'use strict';

    if (typeof game_data === 'undefined' || typeof TribalWars === 'undefined') {
        alert('Run this script from inside Tribal Wars.');
        return;
    }

    // Already running: the game is shown in our frame, so a quickbar click inside it
    // (or a second click in the top window) just refreshes the existing panel.
    try {
        if (window.top !== window && window.top.FillWH) {
            window.top.FillWH.refresh();
            return;
        }
    } catch (e) { /* different origin, ignore */ }
    if (window.FillWH) {
        window.FillWH.refresh();
        return;
    }

    var RES = ['wood', 'stone', 'iron'];
    var STORAGE_KEY = 'fillWH_' + game_data.world + '_' + game_data.player.id;
    var DEFAULTS = {
        sources: [],        // village ids allowed to send resources
        fillPercent: 85,    // fill the target warehouse up to this % per resource
        keepPercent: 20,    // never drain a source below this % of its own warehouse
        carry: 1000,        // resources per merchant
        minSend: 1000,      // skip sends smaller than this (total resources)
        // "Go to next village when..." - when one of these is true, Enter moves on instead of sending
        nextWhenDone: true,     // all proposed sends for this village have been made
        nextWhenAtGoal: true,   // this village is already at the goal
        nextWhenSource: true,   // this village is one of the source villages
        nextWhenStuck: false    // no source village can help
    };

    var target = targetFromGameData(game_data);

    var settings = loadSettings();
    var villages = [];
    var incoming = { wood: 0, stone: 0, iron: 0 };
    var plan = null;
    var frame = null;   // iframe holding the game page; the panel lives above it

    // ---------- storage ----------

    function loadSettings() {
        try {
            var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return $.extend({}, DEFAULTS, saved);
        } catch (e) {
            return $.extend({}, DEFAULTS);
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (e) {
            UI.ErrorMessage('Could not save settings (localStorage blocked).');
        }
    }

    // ---------- helpers ----------

    function targetFromGameData(gd) {
        return {
            id: parseInt(gd.village.id, 10),
            name: gd.village.name,
            x: parseInt(gd.village.x, 10),
            y: parseInt(gd.village.y, 10),
            storage: parseInt(gd.village.storage_max, 10),
            wood: Math.floor(gd.village.wood),
            stone: Math.floor(gd.village.stone),
            iron: Math.floor(gd.village.iron)
        };
    }

    // The panel lives inside the game page shown in the frame (just under the menu bar).
    function panelDoc() {
        try {
            return frame && frame.contentDocument && frame.contentDocument.body ? frame.contentDocument : document;
        } catch (e) {
            return document;
        }
    }

    function $p(selector) {
        return $(selector, panelDoc());
    }

    function url(query) {
        return game_data.link_base_pure + query;
    }

    function parseNumber(text) {
        return parseInt(String(text).replace(/\D/g, ''), 10) || 0;
    }

    function fmt(n) {
        return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function esc(text) {
        return $('<div>').text(text).html();
    }

    function distance(v) {
        return Math.hypot(v.x - target.x, v.y - target.y);
    }

    function sum(r) {
        return r.wood + r.stone + r.iron;
    }

    function resIcon(r) {
        return '<span class="icon header ' + r + '"></span>';
    }

    // ---------- data ----------

    function fetchVillages() {
        return $.get(url('overview_villages&mode=prod&group=0&page=-1')).then(function (html) {
            var list = [];
            $(html).find('#production_table tr').each(function () {
                var $row = $(this);
                var $vn = $row.find('span.quickedit-vn');
                if (!$vn.length) return;
                var coords = $vn.text().match(/\d+\|\d+/g);
                if (!coords) return;
                var xy = coords[coords.length - 1].split('|');

                var v = {
                    id: parseInt($vn.attr('data-id'), 10),
                    name: $row.find('.quickedit-label').text().trim(),
                    x: parseInt(xy[0], 10),
                    y: parseInt(xy[1], 10)
                };
                var $resCell = $row.find('span.res.wood, span.warn_90.wood, span.warn.wood').first().closest('td');
                RES.forEach(function (r) {
                    v[r] = parseNumber($resCell.find('span.res.' + r + ', span.warn_90.' + r + ', span.warn.' + r).first().text());
                });
                var $warehouse = $resCell.next('td');
                var merchants = $warehouse.next('td').text().match(/(\d+)\s*\/\s*(\d+)/);
                v.storage = parseNumber($warehouse.text());
                v.merchants = merchants ? parseInt(merchants[1], 10) : 0;
                list.push(v);
            });
            return list;
        });
    }

    // Resources already travelling to the current village (from anyone).
    function fetchIncoming() {
        return $.get(url('overview_villages&mode=trader&type=inc&group=0&page=-1')).then(function (html) {
            var total = { wood: 0, stone: 0, iron: 0 };
            $(html).find('#trades_table tr').each(function () {
                var cells = this.children;
                if (cells.length < 9 || cells[0].tagName === 'TH') return;
                var href = $(cells[4]).find('a').attr('href') || '';
                var m = href.match(/[?&]id=(\d+)/) || href.match(/village=(\d+)/);
                if (!m || parseInt(m[1], 10) !== target.id) return;
                $(cells[8]).children().each(function () {
                    var classes = this.className + ' ' + $(this).find('[class]').map(function () {
                        return this.className;
                    }).get().join(' ');
                    var type = classes.match(/\b(wood|stone|iron)\b/);
                    if (type) total[type[1]] += parseNumber($(this).text());
                });
            });
            return total;
        });
    }

    // ---------- planning ----------

    function buildPlan() {
        var goal = Math.floor(target.storage * settings.fillPercent / 100);
        var need = {};
        RES.forEach(function (r) {
            need[r] = Math.max(0, goal - target[r] - incoming[r]);
        });

        // Source villages are never filled themselves.
        var sources = isSource() ? [] : villages
            .filter(function (v) { return v.id !== target.id && settings.sources.indexOf(v.id) >= 0; })
            .sort(function (a, b) { return distance(a) - distance(b); });

        var rows = [];
        var skipped = [];
        sources.forEach(function (src) {
            if (sum(need) < settings.minSend) return;
            var keep = Math.floor(src.storage * settings.keepPercent / 100);
            var send = {};
            RES.forEach(function (r) {
                send[r] = Math.min(need[r], Math.max(0, src[r] - keep));
            });

            if (!src.merchants) {
                skipped.push({ src: src, reason: 'no free merchants' });
                return;
            }
            if (sum(send) === 0) {
                skipped.push({ src: src, reason: 'nothing above ' + settings.keepPercent + '% keep (' + fmt(keep) + ') of a missing resource' });
                return;
            }

            // Scale down evenly if there aren't enough merchants for everything.
            var capacity = src.merchants * settings.carry;
            var total = sum(send);
            if (total > capacity) {
                var factor = capacity / total;
                RES.forEach(function (r) { send[r] = Math.floor(send[r] * factor); });
                total = sum(send);
            }
            if (total < settings.minSend) {
                skipped.push({ src: src, reason: 'could only send ' + fmt(total) + ' (below minimum ' + fmt(settings.minSend) + ')' });
                return;
            }

            RES.forEach(function (r) { need[r] -= send[r]; });
            rows.push({
                src: src,
                send: send,
                merchants: Math.ceil(total / settings.carry),
                distance: distance(src),
                sent: false
            });
        });

        var found = villages.map(function (v) { return v.id; });
        var missing = settings.sources.filter(function (id) {
            return id !== target.id && found.indexOf(id) < 0;
        });

        return {
            goal: goal,
            remaining: need,
            rows: rows,
            skipped: skipped,
            missing: missing,
            sourceCount: sources.length
        };
    }

    // ---------- UI ----------

    function injectStyles() {
        [document, panelDoc()].forEach(function (doc) {
            if ($('#fillWH_styles', doc).length) return;
            $('head', doc).append('<style id="fillWH_styles">'
                + '.fillWH-table th, .fillWH-table td { padding: 3px 14px; }'
                + '.fillWH-table td:not(:first-child) { text-align: right; }'
                + '.fillWH-table th { text-align: center; }'
                + '</style>');
        });
    }

    function renderPanel() {
        injectStyles();
        $p('#fillWH').remove();
        plan = buildPlan();

        var html = '<div id="fillWH" class="vis" style="margin:5px 0;padding:6px;">'
            + '<h3 style="margin:0 0 6px;">Fill Warehouse &rarr; ' + esc(target.name)
            + ' (' + target.x + '|' + target.y + ')</h3>'
            + '<table class="vis fillWH-table" style="margin-bottom:6px;"><tr><th></th>'
            + RES.map(function (r) { return '<th>' + resIcon(r) + '</th>'; }).join('')
            + '</tr>'
            + summaryRow('In village', target)
            + summaryRow('Incoming', incoming)
            + summaryRow('Goal (' + settings.fillPercent + '% of ' + fmt(target.storage) + ')',
                { wood: plan.goal, stone: plan.goal, iron: plan.goal })
            + summaryRow('Still missing after plan', plan.remaining)
            + '</table>';

        if (isSource()) {
            html += '<p><b>This is one of your source villages</b>, so nothing is sent to it.</p>';
        } else if (!settings.sources.length) {
            html += '<p><b>No source villages configured.</b> Open Settings to pick them.</p>';
        } else if (!plan.rows.length) {
            if (atGoal()) {
                html += '<p><b>Nothing to send.</b> This village is already at the goal.</p>';
            } else if (!plan.sourceCount) {
                html += '<p><b>Nothing to send.</b> None of your source villages were found (only this village is selected, or the overview could not be read).</p>';
            } else {
                html += '<p><b>Nothing to send.</b> None of your source villages can help right now:</p>';
            }
        } else {
            html += '<table class="vis fillWH-table" width="100%"><tr><th>Source</th><th>Distance</th>'
                + RES.map(function (r) { return '<th>' + resIcon(r) + '</th>'; }).join('')
                + '<th>Merchants</th><th></th></tr>';
            plan.rows.forEach(function (row, i) {
                html += '<tr id="fillWH_row' + i + '">'
                    + '<td>' + esc(row.src.name) + '</td>'
                    + '<td>' + row.distance.toFixed(1) + '</td>'
                    + RES.map(function (r) { return '<td>' + fmt(row.send[r]) + '</td>'; }).join('')
                    + '<td>' + row.merchants + ' / ' + row.src.merchants + '</td>'
                    + '<td><input type="button" class="btn fillWH-send" data-row="' + i + '" value="Send"></td>'
                    + '</tr>';
            });
            html += '</table>';
        }

        html += skippedTable();

        html += '<div style="margin-top:6px;">'
            + '<input type="button" class="btn" id="fillWH_prev" value="&larr; Previous village"> '
            + '<input type="button" class="btn" id="fillWH_next" value="Next village &rarr;"> '
            + '<input type="button" class="btn" id="fillWH_settings" value="Settings"> '
            + '<input type="button" class="btn" id="fillWH_refresh" value="Recalculate"> '
            + '<input type="button" class="btn" id="fillWH_close" value="Close">'
            + '</div></div>';

        var $container = $p('#contentContainer');
        ($container.length ? $container : $p('body')).first().prepend(html);

        $p('#fillWH .fillWH-send').on('click', function () { sendRow(parseInt($(this).data('row'), 10)); });
        $p('#fillWH_prev').on('click', function () { switchVillage('p'); });
        $p('#fillWH_next').on('click', function () { switchVillage('n'); });
        $p('#fillWH_settings').on('click', showSettings);
        $p('#fillWH_refresh').on('click', start);
        $p('#fillWH_close').on('click', closeHost);
        focusNext();
    }

    function isSource() {
        return settings.sources.indexOf(target.id) >= 0;
    }

    function atGoal() {
        var goal = Math.floor(target.storage * settings.fillPercent / 100);
        var missing = RES.reduce(function (total, r) {
            return total + Math.max(0, goal - target[r] - incoming[r]);
        }, 0);
        return missing < settings.minSend;
    }

    // The "Go to next village when..." conditions.
    function shouldGoNext() {
        var rows = plan ? plan.rows : [];
        var allSent = rows.length > 0 && rows.every(function (x) { return x.sent; });
        return (settings.nextWhenSource && isSource())
            || (settings.nextWhenDone && allSent)
            || (settings.nextWhenAtGoal && !rows.length && atGoal())
            || (settings.nextWhenStuck && !rows.length && !atGoal());
    }

    // ---------- frame host ----------
    // The game is shown in an iframe below the panel. Changing village is a normal page load
    // inside the frame (so all game scripts, menus and the quickbar keep working), while the
    // panel in the top window stays.

    function createHost() {
        var startUrl = location.href;
        $('body').children().hide();
        $('body').css({ margin: 0, overflow: 'hidden' });
        var $host = $('<div id="fillWH_host" style="position:fixed;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;"></div>');
        frame = $('<iframe id="fillWH_frame" style="flex:1 1 auto;width:100%;border:0;"></iframe>')[0];
        $host.append(frame);
        $('body').append($host);
        frame.addEventListener('load', onFrameLoad);
        frame.src = startUrl;
    }

    // URL of the page in the frame, with "village=n123"/"p123" replaced by the real village id.
    function frameUrl() {
        var gw = frame.contentWindow;
        return gw.location.href.replace(/([?&]village=)[np]?\d+/, '$1' + gw.game_data.village.id);
    }

    function onFrameLoad() {
        var gd;
        try {
            gd = frame.contentWindow.game_data;
        } catch (e) { /* not a game page */ }
        if (!gd || !gd.village) {
            $p('#fillWH').remove();
            $p('body').prepend('<div id="fillWH" class="vis" style="padding:6px;">Fill Warehouse: this page has no village. '
                + '<input type="button" class="btn" id="fillWH_close" value="Close"></div>');
            $p('#fillWH_close').on('click', closeHost);
            return;
        }
        // Keep the address bar in sync, so refreshing opens the village you are on.
        try {
            history.replaceState(null, '', frameUrl());
            document.title = frame.contentWindow.document.title;
        } catch (e) { /* ignore */ }
        target = targetFromGameData(gd);
        plan = null;
        start();
    }

    // Next/previous village the game's own way ("village=n<id>" / "p<id>"), inside the frame.
    function switchVillage(way) {
        var gw = frame.contentWindow;
        var id = gw.game_data.village.id;
        UI.InfoMessage(way === 'n' ? 'Switching to next village...' : 'Switching to previous village...', 500);
        $p('#fillWH input.btn').prop('disabled', true);
        var href = gw.location.href;
        gw.location.href = /[?&]village=[np]?\d+/.test(href)
            ? href.replace(/([?&]village=)[np]?\d+/, '$1' + way + id)
            : gw.game_data.link_base_pure.replace(/village=\d+/, 'village=' + way + id) + gw.game_data.screen;
    }

    // Back to the normal game page (the village currently shown), without the panel.
    function closeHost() {
        var next = location.href;
        try { next = frameUrl(); } catch (e) { /* keep current URL */ }
        location.href = next;
    }

    // Sources that were considered but couldn't send, with what the script read for them.
    function skippedTable() {
        if (!plan.skipped.length && !plan.missing.length) return '';
        var html = '<table class="vis fillWH-table" style="margin-top:6px;"><tr><th>Skipped source</th>'
            + RES.map(function (r) { return '<th>' + resIcon(r) + '</th>'; }).join('')
            + '<th>Warehouse</th><th>Merchants</th><th>Reason</th></tr>';
        plan.skipped.forEach(function (s) {
            html += '<tr><td>' + esc(s.src.name) + '</td>'
                + RES.map(function (r) { return '<td>' + fmt(s.src[r]) + '</td>'; }).join('')
                + '<td>' + fmt(s.src.storage) + '</td>'
                + '<td>' + s.src.merchants + '</td>'
                + '<td style="text-align:left;">' + s.reason + '</td></tr>';
        });
        if (plan.missing.length) {
            html += '<tr><td colspan="7" style="text-align:left;">' + plan.missing.length
                + ' selected village(s) not found in your production overview (id: ' + plan.missing.join(', ') + ')</td></tr>';
        }
        return html + '</table>';
    }

    function summaryRow(label, r) {
        return '<tr><td>' + label + '</td>'
            + RES.map(function (k) { return '<td>' + fmt(r[k]) + '</td>'; }).join('')
            + '</tr>';
    }

    // Decides what Enter does next: move to the next village if a condition is met, else send the next row.
    function focusNext() {
        var $btn = $p('#fillWH .fillWH-send:enabled').first();
        if (shouldGoNext()) {
            $p('#fillWH_next').focus();
        } else if ($btn.length) {
            $btn.focus();
        }
    }

    function sendRow(i) {
        var row = plan.rows[i];
        if (!row || row.sent || row.pending) return;
        row.pending = true;
        var $buttons = $p('#fillWH .fillWH-send');
        $buttons.prop('disabled', true);
        var sentPlan = plan;
        var sentIncoming = incoming;
        var targetId = target.id;

        TribalWars.post('market', { ajaxaction: 'map_send', village: row.src.id }, {
            target_id: targetId,
            wood: row.send.wood,
            stone: row.send.stone,
            iron: row.send.iron
        }, function (response) {
            row.pending = false;
            row.sent = true;
            UI.SuccessMessage(response && response.message ? response.message : 'Resources sent.');
            if (plan === sentPlan) $p('#fillWH_row' + i).css('opacity', 0.4).find('.fillWH-send').val('Sent').prop('disabled', true);
            RES.forEach(function (r) { sentIncoming[r] += row.send[r]; });
            if (sentPlan.rows.every(function (x) { return x.sent; })) {
                UI.SuccessMessage('Done! Warehouse will be at ~' + settings.fillPercent + '%.');
            }
            if (plan === sentPlan) focusNext();
        }, function () {
            // Game already shows the error message.
            row.pending = false;
            if (plan === sentPlan) $p('#fillWH_row' + i + ' .fillWH-send').prop('disabled', false);
        });

        // Short delay between clicks keeps us under the game's request rate limit.
        setTimeout(function () {
            if (plan !== sentPlan) return;
            plan.rows.forEach(function (x, j) {
                if (!x.sent && !x.pending) $p('#fillWH_row' + j + ' .fillWH-send').prop('disabled', false);
            });
            focusNext();
        }, 250);
    }

    function showSettings() {
        var sorted = villages.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
        var html = '<div style="max-width:650px;">'
            + '<h3>Fill Warehouse settings</h3>'
            + '<table class="vis fillWH-table">'
            + numberInput('fillWH_fill', 'Fill target warehouse to (%)', settings.fillPercent)
            + numberInput('fillWH_keep', 'Keep at least this % in source villages', settings.keepPercent)
            + numberInput('fillWH_carry', 'Resources per merchant', settings.carry)
            + numberInput('fillWH_min', 'Skip sends smaller than', settings.minSend)
            + '</table>'
            + '<h4 style="margin-top:10px;">Go to next village (on Enter) when...</h4>'
            + checkboxInput('fillWH_nextDone', 'all proposed sends for this village are done', settings.nextWhenDone)
            + checkboxInput('fillWH_nextGoal', 'this village is already at the goal', settings.nextWhenAtGoal)
            + checkboxInput('fillWH_nextSource', 'this village is one of my source villages', settings.nextWhenSource)
            + checkboxInput('fillWH_nextStuck', 'no source village can help', settings.nextWhenStuck)
            + '<h4 style="margin-top:10px;">Source villages (' + '<span id="fillWH_count"></span> selected)</h4>'
            + '<input type="text" id="fillWH_filter" placeholder="Filter by name or coords" style="width:200px;"> '
            + '<input type="button" class="btn" id="fillWH_all" value="Select shown"> '
            + '<input type="button" class="btn" id="fillWH_none" value="Clear shown">'
            + '<div style="max-height:350px;overflow:auto;margin-top:6px;"><table class="vis fillWH-table" width="100%">'
            + '<tr><th></th><th>Village</th><th>Warehouse</th>'
            + RES.map(function (r) { return '<th>' + resIcon(r) + '</th>'; }).join('')
            + '</tr>';
        sorted.forEach(function (v) {
            var checked = settings.sources.indexOf(v.id) >= 0 ? ' checked' : '';
            html += '<tr class="fillWH-vrow" data-search="' + esc((v.name + ' ' + v.x + '|' + v.y).toLowerCase()) + '">'
                + '<td><input type="checkbox" class="fillWH-src" value="' + v.id + '"' + checked + '></td>'
                + '<td style="text-align:left;">' + esc(v.name) + '</td>'
                + '<td>' + fmt(v.storage) + '</td>'
                + RES.map(function (r) { return '<td>' + fmt(v[r]) + '</td>'; }).join('')
                + '</tr>';
        });
        html += '</table></div>'
            + '<div style="margin-top:8px;"><input type="button" class="btn btn-confirm-yes" id="fillWH_save" value="Save"></div>'
            + '</div>';

        Dialog.show('fillWH_settings', html);

        var updateCount = function () { $('#fillWH_count').text($('.fillWH-src:checked').length); };
        updateCount();
        $('.fillWH-src').on('change', updateCount);
        $('#fillWH_filter').on('input', function () {
            var q = this.value.toLowerCase();
            $('.fillWH-vrow').each(function () {
                $(this).toggle($(this).data('search').indexOf(q) >= 0);
            });
        });
        $('#fillWH_all').on('click', function () { $('.fillWH-vrow:visible .fillWH-src').prop('checked', true); updateCount(); });
        $('#fillWH_none').on('click', function () { $('.fillWH-vrow:visible .fillWH-src').prop('checked', false); updateCount(); });
        $('#fillWH_save').on('click', function () {
            settings.fillPercent = clamp($('#fillWH_fill').val(), 1, 100, DEFAULTS.fillPercent);
            settings.keepPercent = clamp($('#fillWH_keep').val(), 0, 100, DEFAULTS.keepPercent);
            settings.carry = clamp($('#fillWH_carry').val(), 1, 100000, DEFAULTS.carry);
            settings.minSend = clamp($('#fillWH_min').val(), 0, 1000000, DEFAULTS.minSend);
            settings.nextWhenDone = $('#fillWH_nextDone').prop('checked');
            settings.nextWhenAtGoal = $('#fillWH_nextGoal').prop('checked');
            settings.nextWhenSource = $('#fillWH_nextSource').prop('checked');
            settings.nextWhenStuck = $('#fillWH_nextStuck').prop('checked');
            settings.sources = $('.fillWH-src:checked').map(function () { return parseInt(this.value, 10); }).get();
            saveSettings();
            Dialog.close();
            renderPanel();
        });
    }

    function numberInput(id, label, value) {
        return '<tr><td>' + label + '</td><td><input type="number" id="' + id + '" value="' + value + '" style="width:80px;"></td></tr>';
    }

    function checkboxInput(id, label, checked) {
        return '<div><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '> '
            + '<label for="' + id + '">' + label + '</label></div>';
    }

    function clamp(value, min, max, fallback) {
        var n = parseInt(value, 10);
        if (isNaN(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    }

    // ---------- start ----------

    function start() {
        $p('#fillWH').remove();
        $.when(fetchVillages(), fetchIncoming()).done(function (list, inc) {
            villages = list;
            incoming = inc;
            // Use fresh numbers for the current village if the overview has them.
            villages.forEach(function (v) {
                if (v.id === target.id) {
                    RES.forEach(function (r) { target[r] = v[r]; });
                    if (v.storage) target.storage = v.storage;
                }
            });
            renderPanel();
            if (!settings.sources.length) showSettings();
        }).fail(function () {
            UI.ErrorMessage('Fill Warehouse: could not load village data.');
        });
    }

    window.FillWH = { refresh: function () { start(); } };
    createHost();   // the frame's load event calls start()
})();
