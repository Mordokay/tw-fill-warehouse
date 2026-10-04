/*
 * Fill Warehouse v1.1.1
 *
 * Run it while viewing an underdeveloped village. It pulls resources from your
 * configured source villages (closest first) until this village's warehouse
 * reaches the configured fill percentage, or exact amounts typed in the panel
 * (e.g. a building's cost), counting resources already in the village and on the way.
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
    var incomingByVillage = {};                    // village id -> resources on the way
    var incoming = { wood: 0, stone: 0, iron: 0 }; // entry for the current target
    var plan = null;
    var customGoal = null;   // exact amounts typed in the panel ({wood, stone, iron}), or null for the % goal

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

    // Resources already travelling to each of your villages (from anyone), keyed by village id.
    function fetchIncoming() {
        return $.get(url('overview_villages&mode=trader&type=inc&group=0&page=-1')).then(function (html) {
            var byVillage = {};
            $(html).find('#trades_table tr').each(function () {
                var cells = this.children;
                if (cells.length < 9 || cells[0].tagName === 'TH') return;
                var href = $(cells[4]).find('a').attr('href') || '';
                var m = href.match(/[?&]id=(\d+)/) || href.match(/village=(\d+)/);
                if (!m) return;
                var total = incomingFor(byVillage, parseInt(m[1], 10));
                $(cells[8]).children().each(function () {
                    var classes = this.className + ' ' + $(this).find('[class]').map(function () {
                        return this.className;
                    }).get().join(' ');
                    var type = classes.match(/\b(wood|stone|iron)\b/);
                    if (type) total[type[1]] += parseNumber($(this).text());
                });
            });
            return byVillage;
        });
    }

    function incomingFor(byVillage, id) {
        if (!byVillage[id]) byVillage[id] = { wood: 0, stone: 0, iron: 0 };
        return byVillage[id];
    }

    // Goal per resource: the exact amounts typed in the panel (never more than the warehouse
    // holds), or the fill % from Settings.
    function goalFor(v) {
        var goal = {};
        RES.forEach(function (r) {
            goal[r] = customGoal
                ? Math.min(customGoal[r], v.storage)
                : Math.floor(v.storage * settings.fillPercent / 100);
        });
        return goal;
    }

    // Total still needed to reach the goal, counting what's already on the way.
    function missingTotal(v) {
        var goal = goalFor(v);
        var inc = incomingFor(incomingByVillage, v.id);
        return RES.reduce(function (total, r) {
            return total + Math.max(0, goal[r] - v[r] - inc[r]);
        }, 0);
    }

    // ---------- planning ----------

    function buildPlan() {
        var goal = goalFor(target);
        var need = {};
        RES.forEach(function (r) {
            need[r] = Math.max(0, goal[r] - target[r] - incoming[r]);
        });

        var sources = villages
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
                targetId: target.id,
                sent: false
            });
        });

        var found = sources.map(function (v) { return v.id; });
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
        if ($('#fillWH_styles').length) return;
        $('head').append('<style id="fillWH_styles">'
            + '.fillWH-table th, .fillWH-table td { padding: 3px 14px; }'
            + '.fillWH-table td:not(:first-child) { text-align: right; }'
            + '.fillWH-table th { text-align: center; }'
            + '</style>');
    }

    function renderPanel() {
        injectStyles();
        $('#fillWH').remove();
        plan = buildPlan();

        var html = '<div id="fillWH" class="vis" style="margin:5px 0;padding:6px;">'
            + '<h3 style="margin:0 0 6px;">Fill Warehouse &rarr; ' + esc(target.name) + '</h3>'
            + '<table class="vis fillWH-table" style="margin-bottom:6px;"><tr><th></th>'
            + RES.map(function (r) { return '<th>' + resIcon(r) + '</th>'; }).join('')
            + '</tr>'
            + summaryRow('In village', target)
            + summaryRow('Incoming', incoming)
            + summaryRow(customGoal ? 'Goal (exact amounts)' : 'Goal (' + settings.fillPercent + '% of ' + fmt(target.storage) + ')', plan.goal)
            + summaryRow('Still missing after plan', plan.remaining)
            + '<tr><td>Exact amounts</td>'
            + RES.map(function (r) {
                return '<td><input type="text" class="fillWH-amount" data-res="' + r + '" size="7" style="text-align:right;"'
                    + ' value="' + (customGoal ? fmt(customGoal[r]) : '') + '"></td>';
            }).join('')
            + '</tr></table>'
            + '<div style="margin-bottom:6px;">'
            + '<input type="button" class="btn" id="fillWH_useAmounts" value="Use amounts"> '
            + (customGoal ? '<input type="button" class="btn" id="fillWH_usePercent" value="Use % (' + settings.fillPercent + '%)">' : '')
            + ' <span style="font-size:0.9em;">Type the total you need in the village (e.g. a building\'s cost); what it has and what is on the way is subtracted.</span>'
            + '</div>';

        if (customGoal && RES.some(function (r) { return customGoal[r] > target.storage; })) {
            html += '<p><b>Warning:</b> some amounts are bigger than the warehouse (' + fmt(target.storage)
                + '), so they were capped to the warehouse size.</p>';
        }

        if (!settings.sources.length) {
            html += '<p><b>No source villages configured.</b> Open Settings to pick them.</p>';
        } else if (!plan.rows.length) {
            if (missingTotal(target) < settings.minSend) {
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
            + '<input type="button" class="btn" id="fillWH_settings" value="Settings"> '
            + '<input type="button" class="btn" id="fillWH_refresh" value="Recalculate"> '
            + '<input type="button" class="btn" id="fillWH_close" value="Close">'
            + '</div></div>';

        var $container = $('#contentContainer').length ? $('#contentContainer') : $('#mobileContent, body').first();
        $container.prepend(html);

        $('#fillWH .fillWH-send').on('click', function () { sendRow(parseInt($(this).data('row'), 10)); });
        $('#fillWH_settings').on('click', showSettings);
        $('#fillWH_refresh').on('click', function () { start(); });
        $('#fillWH_useAmounts').on('click', useAmounts);
        $('#fillWH_usePercent').on('click', function () { customGoal = null; start(); });
        $('#fillWH .fillWH-amount').on('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                useAmounts();
            }
        });
        $('#fillWH_close').on('click', function () { $('#fillWH').remove(); });
        focusNext();
    }

    // Reads the three amount fields. Empty field = that resource isn't needed; all empty = back to %.
    function useAmounts() {
        var amounts = {};
        var any = false;
        $('#fillWH .fillWH-amount').each(function () {
            var value = $(this).val().trim();
            amounts[$(this).data('res')] = parseNumber(value);
            if (value !== '') any = true;
        });
        customGoal = any ? amounts : null;
        start();
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

    function focusNext() {
        var $btn = $('#fillWH .fillWH-send:enabled').first();
        if ($btn.length) $btn.focus();
    }

    function sendRow(i) {
        var row = plan.rows[i];
        // A row stays "pending" from the click until the game answers, so it can't be sent twice.
        if (!row || row.sent || row.pending) return;
        row.pending = true;
        var $buttons = $('#fillWH .fillWH-send');
        $buttons.prop('disabled', true);
        var sentPlan = plan;
        var sentIncoming = incoming;

        TribalWars.post('market', { ajaxaction: 'map_send', village: row.src.id }, {
            target_id: row.targetId,
            wood: row.send.wood,
            stone: row.send.stone,
            iron: row.send.iron
        }, function (response) {
            row.pending = false;
            row.sent = true;
            UI.SuccessMessage(response && response.message ? response.message : 'Resources sent.');
            if (plan === sentPlan) $('#fillWH_row' + i).css('opacity', 0.4).find('.fillWH-send').val('Sent').prop('disabled', true);
            RES.forEach(function (r) { sentIncoming[r] += row.send[r]; });
            if (sentPlan.rows.every(function (x) { return x.sent; })) {
                UI.SuccessMessage(customGoal
                    ? 'Done! The requested amounts are on their way.'
                    : 'Done! Warehouse will be at ~' + settings.fillPercent + '%.');
            }
            if (plan === sentPlan) focusNext();
        }, function () {
            // Game already shows the error message; allow retrying this row.
            row.pending = false;
            if (plan === sentPlan) $('#fillWH_row' + i + ' .fillWH-send').prop('disabled', false);
        });

        // Short delay between clicks keeps us under the game's request rate limit.
        setTimeout(function () {
            if (plan !== sentPlan) return;
            plan.rows.forEach(function (x, j) {
                if (!x.sent && !x.pending) $('#fillWH_row' + j + ' .fillWH-send').prop('disabled', false);
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

    // Loads fresh data (so earlier sends are counted) and draws the panel.
    function start() {
        $('#fillWH input.btn').prop('disabled', true);
        $.when(fetchVillages(), fetchIncoming()).done(function (list, inc) {
            villages = list;
            incomingByVillage = inc;

            var current = villages.find(function (v) { return v.id === target.id; });
            if (current) target = $.extend({}, current);

            incoming = incomingFor(incomingByVillage, target.id);
            renderPanel();
            if (!settings.sources.length) showSettings();
        }).fail(function () {
            $('#fillWH input.btn').prop('disabled', false);
            UI.ErrorMessage('Fill Warehouse: could not load village data.');
        });
    }

    start();
})();
