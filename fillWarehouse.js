/*
 * Fill Warehouse
 *
 * Run it while viewing an underdeveloped village. It pulls resources from your
 * configured source villages (closest first) until this village's warehouse
 * reaches the configured fill percentage, counting resources already on the way.
 *
 * Every market send is its own button click (one click = one action).
 * Settings are stored per world in localStorage.
 */
(function () {
    'use strict';

    if (typeof game_data === 'undefined' || typeof TribalWars === 'undefined') {
        alert('Run this script from inside Tribal Wars.');
        return;
    }

    var RES = ['wood', 'stone', 'iron'];
    var STORAGE_KEY = 'fillWH_' + game_data.world + '_' + game_data.player.id;
    var DEFAULTS = {
        sources: [],        // village ids allowed to send resources
        fillPercent: 85,    // fill the target warehouse up to this % per resource
        keepPercent: 20,    // never drain a source below this % of its own warehouse
        carry: 1000,        // resources per merchant
        minSend: 1000       // skip sends smaller than this (total resources)
    };

    var target = {
        id: parseInt(game_data.village.id, 10),
        name: game_data.village.name,
        x: parseInt(game_data.village.x, 10),
        y: parseInt(game_data.village.y, 10),
        storage: parseInt(game_data.village.storage_max, 10),
        wood: Math.floor(game_data.village.wood),
        stone: Math.floor(game_data.village.stone),
        iron: Math.floor(game_data.village.iron)
    };

    var settings = loadSettings();
    var villages = [];
    var incoming = { wood: 0, stone: 0, iron: 0 };
    var plan = null;

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

        var sources = villages
            .filter(function (v) { return v.id !== target.id && settings.sources.indexOf(v.id) >= 0; })
            .sort(function (a, b) { return distance(a) - distance(b); });

        var rows = [];
        sources.forEach(function (src) {
            if (sum(need) < settings.minSend) return;
            var keep = Math.floor(src.storage * settings.keepPercent / 100);
            var send = {};
            RES.forEach(function (r) {
                send[r] = Math.min(need[r], Math.max(0, src[r] - keep));
            });

            // Scale down evenly if there aren't enough merchants for everything.
            var capacity = src.merchants * settings.carry;
            var total = sum(send);
            if (total > capacity) {
                var factor = capacity / total;
                RES.forEach(function (r) { send[r] = Math.floor(send[r] * factor); });
                total = sum(send);
            }
            if (total < settings.minSend) return;

            RES.forEach(function (r) { need[r] -= send[r]; });
            rows.push({
                src: src,
                send: send,
                merchants: Math.ceil(total / settings.carry),
                distance: distance(src),
                sent: false
            });
        });

        return { goal: goal, remaining: need, rows: rows };
    }

    // ---------- UI ----------

    function renderPanel() {
        $('#fillWH').remove();
        plan = buildPlan();

        var html = '<div id="fillWH" class="vis" style="margin:5px 0;padding:6px;">'
            + '<h3 style="margin:0 0 6px;">Fill Warehouse &rarr; ' + esc(target.name)
            + ' (' + target.x + '|' + target.y + ')</h3>'
            + '<table class="vis" style="margin-bottom:6px;"><tr><th></th>'
            + RES.map(function (r) { return '<th>' + resIcon(r) + '</th>'; }).join('')
            + '</tr>'
            + summaryRow('In village', target)
            + summaryRow('Incoming', incoming)
            + summaryRow('Goal (' + settings.fillPercent + '% of ' + fmt(target.storage) + ')',
                { wood: plan.goal, stone: plan.goal, iron: plan.goal })
            + summaryRow('Still missing after plan', plan.remaining)
            + '</table>';

        if (!settings.sources.length) {
            html += '<p><b>No source villages configured.</b> Open Settings to pick them.</p>';
        } else if (!plan.rows.length) {
            html += '<p><b>Nothing to send.</b> This village is already at the goal, or no source has spare resources/merchants.</p>';
        } else {
            html += '<table class="vis" width="100%"><tr><th>Source</th><th>Distance</th>'
                + RES.map(function (r) { return '<th>' + resIcon(r) + '</th>'; }).join('')
                + '<th>Merchants</th><th></th></tr>';
            plan.rows.forEach(function (row, i) {
                html += '<tr id="fillWH_row' + i + '">'
                    + '<td>' + esc(row.src.name) + ' (' + row.src.x + '|' + row.src.y + ')</td>'
                    + '<td>' + row.distance.toFixed(1) + '</td>'
                    + RES.map(function (r) { return '<td>' + fmt(row.send[r]) + '</td>'; }).join('')
                    + '<td>' + row.merchants + ' / ' + row.src.merchants + '</td>'
                    + '<td><input type="button" class="btn fillWH-send" data-row="' + i + '" value="Send"></td>'
                    + '</tr>';
            });
            html += '</table>';
        }

        var next = $('#village_switch_right').attr('href');
        html += '<div style="margin-top:6px;">'
            + '<input type="button" class="btn" id="fillWH_settings" value="Settings"> '
            + '<input type="button" class="btn" id="fillWH_refresh" value="Recalculate"> '
            + (next ? '<a class="btn" id="fillWH_next" href="' + esc(next) + '">Next village &rarr;</a> ' : '')
            + '<input type="button" class="btn" id="fillWH_close" value="Close">'
            + '</div></div>';

        var $container = $('#contentContainer').length ? $('#contentContainer') : $('#mobileContent, body').first();
        $container.prepend(html);

        $('#fillWH .fillWH-send').on('click', function () { sendRow(parseInt($(this).data('row'), 10)); });
        $('#fillWH_settings').on('click', showSettings);
        $('#fillWH_refresh').on('click', start);
        $('#fillWH_close').on('click', function () { $('#fillWH').remove(); });
        focusNext();
    }

    function summaryRow(label, r) {
        return '<tr><td>' + label + '</td>'
            + RES.map(function (k) { return '<td>' + fmt(r[k]) + '</td>'; }).join('')
            + '</tr>';
    }

    function focusNext() {
        var $btn = $('#fillWH .fillWH-send:enabled').first();
        if ($btn.length) {
            $btn.focus();
        } else {
            $('#fillWH_next').focus();
        }
    }

    function sendRow(i) {
        var row = plan.rows[i];
        if (!row || row.sent) return;
        var $buttons = $('#fillWH .fillWH-send');
        $buttons.prop('disabled', true);

        TribalWars.post('market', { ajaxaction: 'map_send', village: row.src.id }, {
            target_id: target.id,
            wood: row.send.wood,
            stone: row.send.stone,
            iron: row.send.iron
        }, function (response) {
            row.sent = true;
            UI.SuccessMessage(response && response.message ? response.message : 'Resources sent.');
            $('#fillWH_row' + i).css('opacity', 0.4).find('.fillWH-send').val('Sent').prop('disabled', true);
            RES.forEach(function (r) { incoming[r] += row.send[r]; });
            if (plan.rows.every(function (x) { return x.sent; })) {
                UI.SuccessMessage('Done! Warehouse will be at ~' + settings.fillPercent + '%.');
            }
        }, function () {
            // Game already shows the error message.
        });

        // Short delay between clicks keeps us under the game's request rate limit.
        setTimeout(function () {
            plan.rows.forEach(function (x, j) {
                if (!x.sent && j !== i) $('#fillWH_row' + j + ' .fillWH-send').prop('disabled', false);
            });
            if (!row.sent) $('#fillWH_row' + i + ' .fillWH-send').prop('disabled', false);
            focusNext();
        }, 250);
    }

    function showSettings() {
        var sorted = villages.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
        var html = '<div style="max-width:650px;">'
            + '<h3>Fill Warehouse settings</h3>'
            + '<table class="vis">'
            + numberInput('fillWH_fill', 'Fill target warehouse to (%)', settings.fillPercent)
            + numberInput('fillWH_keep', 'Keep at least this % in source villages', settings.keepPercent)
            + numberInput('fillWH_carry', 'Resources per merchant', settings.carry)
            + numberInput('fillWH_min', 'Skip sends smaller than', settings.minSend)
            + '</table>'
            + '<h4 style="margin-top:10px;">Source villages (' + '<span id="fillWH_count"></span> selected)</h4>'
            + '<input type="text" id="fillWH_filter" placeholder="Filter by name or coords" style="width:200px;"> '
            + '<input type="button" class="btn" id="fillWH_all" value="Select shown"> '
            + '<input type="button" class="btn" id="fillWH_none" value="Clear shown">'
            + '<div style="max-height:350px;overflow:auto;margin-top:6px;"><table class="vis" width="100%">'
            + '<tr><th></th><th>Village</th><th>Warehouse</th>'
            + RES.map(function (r) { return '<th>' + resIcon(r) + '</th>'; }).join('')
            + '</tr>';
        sorted.forEach(function (v) {
            var checked = settings.sources.indexOf(v.id) >= 0 ? ' checked' : '';
            html += '<tr class="fillWH-vrow" data-search="' + esc((v.name + ' ' + v.x + '|' + v.y).toLowerCase()) + '">'
                + '<td><input type="checkbox" class="fillWH-src" value="' + v.id + '"' + checked + '></td>'
                + '<td>' + esc(v.name) + ' (' + v.x + '|' + v.y + ')</td>'
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
            settings.sources = $('.fillWH-src:checked').map(function () { return parseInt(this.value, 10); }).get();
            saveSettings();
            Dialog.close();
            renderPanel();
        });
    }

    function numberInput(id, label, value) {
        return '<tr><td>' + label + '</td><td><input type="number" id="' + id + '" value="' + value + '" style="width:80px;"></td></tr>';
    }

    function clamp(value, min, max, fallback) {
        var n = parseInt(value, 10);
        if (isNaN(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    }

    // ---------- start ----------

    function start() {
        $('#fillWH').remove();
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

    start();
})();
