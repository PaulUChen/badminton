const COURT_STATUS = {
    EMPTY: 1,       // 空場地
    ASSIGN: 2,      // 指派人員中
    IN_USE: 3       // 使用中
};
const PLAYER_STATUS = {
    REST: 1,        // 不排場
    WAIT: 2,        // 等待上場
    PLAY: 3         // 比賽中
};
const LEVEL = {
    GREEN: 1,
    YELLOW: 2,
    RED: 3,
    BLUE: 4,
}
// Google Apps Script Web App URL
var GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby2Qsdc4VaSchDgmTN1tQhE7UOKt6MoH_xpiLJjlgcgfYpfB0o-gsueVDVw1MWfzRv3/exec';

function getCombinationsBy2(ary) {
    var results = [];
    for (let i = 0; i < ary.length - 1; i++) {
        for (let j = i + 1; j < ary.length; j++) {
            results.push([ary[i], ary[j]]);
        }
    }
    return results;
}
// make [].shuffle() chainable
Array.prototype.shuffle = function () {
    var i = this.length;
    while (i) {
        var j = Math.floor(Math.random() * i);
        var t = this[--i];
        this[i] = this[j];
        this[j] = t;
    }
    return this;
}
const GAME = {
    /* 玩家
    [
        {
            name,
            playCount: 0
            isPlaying: false,
            active: true,
            friends: ['A', 'B', 'A'],   // 隊友過
            enemies: ['B', 'C'],        // 對手過
            rest: true, // 新增rest參數,初始為true,代表不排場
        },
    ]
    */
    playerId: 1,
    players: [],
    gameHistory: [],
    gameTimers: {}, // 儲存每個場地的計時器
    gameStartTimes: {}, // 儲存每個場地的開始時間
    /* 場地
    [
        {
            index: 0,
            players: [],
        },
    ]
    */
    courts: [],
    /**
     *  加場地
     *  @return {Court} - 加入的場地資料
     */
    addCourt() {
        var court = {
            id: this.courts.length == 0 ? 1 : (this.courts.sort((a, b) => b.id - a.id)[0].id + 1),
            players: [],
            status: 0,
            courtName: String.fromCharCode(65 + this.courts.length) // 使用字母A, B, C, ...
        }
        this.courts.push(court)
        return court
    },
    /**
     *  移除空場地
     *  @return {Court} - 被移除的場地資料
     */
    removeEmptyCourt() {
        var index = this.courts.findIndex(c => c.players.length == 0)
        if (index >= 0) {
            return this.courts.splice(index, 1)[0];
        }
        return undefined;
    },
    /**
     *  遊戲結束
     *  @param {Number} id - 場地編號
     *  @return {Array} - 那一場的玩家
     */
    gameFinish(id) {
        var court = this.courts.find(c => c.id == id);
        if (court) {
            court.status = COURT_STATUS.EMPTY;
            var players = court.players.splice(0);
            players.forEach(p => p.status = PLAYER_STATUS.WAIT);
            // 添加比賽歷程記錄
            var playerNames = players.map(p => p.name).join(', ');
            if (playerNames) {
                // 獲取比賽時間並添加到歷程中
                const gameTime = this.getGameTime(id);
                const timeString = this.formatTime(gameTime);
                const record = `${playerNames} (${timeString})`;
                this.gameHistory.push(record);
                this.updateGameHistoryDisplay();
            }
            // 停止計時器
            this.stopGameTimer(id);
            return players;
        } else {
            console.log('court index error', id);
            return [];
        }
    },
    /**
     * 開始比賽計時
     * @param {Number} courtId - 場地編號
     */
    startGameTimer(courtId) {
        if (this.gameTimers && this.gameTimers[courtId]) {
            clearInterval(this.gameTimers[courtId]);
        }
        if (!this.gameStartTimes) this.gameStartTimes = {};
        if (!this.gameTimers) this.gameTimers = {};
        this.gameStartTimes[courtId] = Date.now();
        this.gameTimers[courtId] = setInterval(() => {
            this.updateGameTimerDisplay(courtId);
        }, 1000);
    },
    /**
     * 停止比賽計時
     * @param {Number} courtId - 場地編號
     */
    stopGameTimer(courtId) {
        if (this.gameTimers && this.gameTimers[courtId]) {
            clearInterval(this.gameTimers[courtId]);
            delete this.gameTimers[courtId];
        }
        if (this.gameStartTimes && this.gameStartTimes[courtId]) {
            delete this.gameStartTimes[courtId];
        }
        // 清空計時器顯示
        this.updateGameTimerDisplay(courtId, true);
    },
    /**
     * 獲取比賽時間（毫秒）
     * @param {Number} courtId - 場地編號
     * @return {Number} - 比賽時間（毫秒）
     */
    getGameTime(courtId) {
        if (!this.gameStartTimes || !this.gameStartTimes[courtId]) return 0;
        return Date.now() - this.gameStartTimes[courtId];
    },
    /**
     * 格式化時間為 HH:MM:SS 格式
     * @param {Number} milliseconds - 毫秒數
     * @return {String} - 格式化後的時間字串
     */
    formatTime(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    },
    /**
     * 更新計時器顯示
     * @param {Number} courtId - 場地編號
     * @param {Boolean} clear - 是否清空顯示
     */
    updateGameTimerDisplay(courtId, clear = false) {
        const timerElement = document.querySelector(`#court-${courtId}-timer`);
        if (timerElement) {
            if (clear) {
                timerElement.textContent = '';
            } else {
                const gameTime = this.getGameTime(courtId);
                timerElement.textContent = this.formatTime(gameTime);
            }
        }
    },
    /**
     * 更新顯示的玩家列表
     */
    updatePlayerListDisplay() {
        // 假設你的玩家列表是顯示在一個 id 為 playerList 的元素中
        $('#playerList').empty();
        this.players.forEach(player => {
            $('#playerList').append(`<li><span>${player.name}</span></li>`);
        });
    },
    /**
     * 更新歷史紀錄列表
     */
    updateGameHistoryDisplay() {
        $('#gameHistoryList').empty();
        this.gameHistory.forEach((record, index) => {
            $('#gameHistoryList').append(`<li><span>${index + 1}. ${record}</span></li>`);
        });
    },
    /**
     *  下一輪的遊戲
     *  @return {Court[]} - 回傳本來是空的場，現在被補上玩家的那些場地資料array
     */
    nextGame(courtId = -1) {
        if(courtId > -1) {
            const court = this.courts.find(c => c.id === courtId);
            var freePlayers = this.find4Players_team();
            // 人不夠
            if (freePlayers.length == 0) {
                return false;
            }
            court.players.push(...freePlayers)
            court.players.forEach((p, i, ary) => {
                var friendIndex = [1, 0, 3, 2][i];
                p.friends.push(ary[friendIndex]?ary[friendIndex].name:"");
                var enemies = (i > 1 ? ary.slice(0, 2) : ary.slice(2, 4)).map(e => e.name);
                p.enemies.push(...enemies)
            });
            console.log('court', court.id, ', players', court.players);
            return true;
        } else {
            return this.courts
                .filter(c => c.players.length == 0) // 空的場
                .filter(court => {                  // 填上玩家的場
                    var freePlayers = this.find4Players_team();
                    // 人不夠
                    if (freePlayers.length == 0) {
                        return false;
                    }
                    court.players.push(...freePlayers)
                    court.players.forEach((p, i, ary) => {
                        var friendIndex = [1, 0, 3, 2][i];
                        p.friends.push(ary[friendIndex].name);
                        var enemies = (i > 1 ? ary.slice(0, 2) : ary.slice(2, 4)).map(e => e.name);
                        p.enemies.push(...enemies)
                    });
                    console.log('court', court.id, ', players', court.players);
                    return true;
                });
        }
    },
    /**
     *  找閒置的玩家, 依玩過的場次少到多排序, 同樣場次玩家會按照隊友對手次數積分來排行
     *  @return {Player[]} - 閒置的玩家
     */
    find4Players_team() {
        // 雖然一次只能取出四個人, 但是一開始在撈人數的時候直接看最後會需要幾個人, 讓分組時比較多人進來
        var courtCount = this.courts.filter(c => c.players.length == 0).length;
        console.log(this.players);
        var players = this.players
            .filter(p => p.status == PLAYER_STATUS.WAIT && !this.courts.some(c => c.players.includes(p)))// ?? 過濾掉正在遊戲中和不排場的玩家
            .reduce((ary, p) => {
            /* 
                照場次放到籃子裡面, array index x 表示玩過x 場的玩家們
                [
                    [{玩過0次},{玩過0次}],
                    ,
                    [{玩過2次}]
                    ,
                    ,
                    [{玩過5次},{玩過5次},{玩過5次},{玩過5次}],
                ]
            */
            var index = p.playCount;
            (ary[index] = ary[index] || []).push(p);
            return ary;
            }, [])
            .reduce((ary, players) => {
              // 人數不夠就把下一籃的人倒進去
              if (ary.length < courtCount * 4) {
                  ary.push(...players)
              }
              return ary;
            }, [])
        // 兩人一隊分法
        // teams = [[1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8], [1, 9], [1, 10], [1, 11], ...]
        var teams = getCombinationsBy2(players);
        // 兩隊一場比賽
        // var twoTeams = [[[1, 2], [1, 3]],[[1, 2], [1, 4]],[[1, 2], [1, 5]],[[1, 2], [1, 6]], ...]
        var twoTeams = getCombinationsBy2(teams);
        var t = twoTeams.length
        // 過濾掉兩邊隊伍有重複人的狀況
        // var twoTeams = [[[1, 2], [3, 4]],[[1, 2], [3, 5]],[[1, 2], [3, 6]],[[1, 2], [3, 7]], ...];
        var twoTeams = twoTeams.filter(([team1, team2]) => team1.every(p => !team2.includes(p)))
        console.log(`${players.length}人, ${teams.length}種隊伍, ${twoTeams.length}種比賽可能(未扣除兩邊重複人數前${t})`)
        if (twoTeams.length == 0) {
            return [];
        }
        return twoTeams
            .map(twoTeam => { // twoTeam: [[player1, player2], [player3, player4]]
                return {
                    twoTeam,
                    totalPlayCount: twoTeam.flat().reduce((sum, p) => sum + p.playCount, 0),
                };
            })
            .sort((a, b) => a.totalPlayCount - b.totalPlayCount)               // 上場場次從小排到大
            .filter((obj, i, a) => obj.totalPlayCount == a[0].totalPlayCount)   // 找出上場場次最少的那一群
            .map(obj => obj.twoTeam)                                            // 只取資料
            .shuffle()[0]                                                       // 隨機取一組
            .flat(); 
    },
    /**
     *  加玩家
     *  @param {String} playerName - 玩家的名字
     *  @return {Player} - 加入的玩家資料
     */
    addPlayer(playerName, playerLevel) {
        if (this.players.find(p => p.name == playerName)) {
            alert('名稱重複');
            return;
        }
        var player = {
            id: this.playerId,
            name: playerName,
            playCount: 0,
            status: PLAYER_STATUS.REST,
            friends: [],
            enemies: [],
            level: playerLevel,// 1: 綠色, 2: 黃色, 3: 紅色, 4: 藍色
        }
        this.playerId++;
        this.players.push(player);
        return player;
    },
    /**
     *  移除玩家
     *  @param {String} playerName - 玩家的名字
     *  @return {Player} - 被移除的玩家資料
     */
    removePlayer(playerName) {
        var playerIndex = this.players.findIndex(p => p.name == playerName);
        if (playerIndex !== -1) {
            var player = this.players.splice(playerIndex, 1)[0];
            this.updatePlayerListDisplay();
            return true;
        } else {
            console.log(`Player with name ${playerName} not found.`);
            return false;
        }
    },
    /**
     *  重置所有玩家紀錄
     */
     resetRecord() {
        this.players.forEach(player => {
            // player.playCount = 0;
            player.friends = [];
            player.enemies = [];
            player.status = PLAYER_STATUS.REST;
        });
        this.gameHistory = [];
        this.updateGameHistoryDisplay();
        // 重置所有場地狀態和計時器
        this.courts.forEach(court => {
            if (court.status === COURT_STATUS.IN_USE) {
                court.status = COURT_STATUS.EMPTY;
                this.stopGameTimer(court.id);
            }
            court.players = [];
        });
    },
    /**
     *  清除所有玩家
     */
    resetPeople() {
        this.players = [];
    },
    /**
     *  清除所有場地
     */
    resetCourt() {
        // 停止所有計時器
        this.courts.forEach(court => {
            this.stopGameTimer(court.id);
        });
        this.courts = [];
    },
    /**
     *  從 CSV 文字匯入球員
     *  @param {String} csvText - CSV 文字內容
     *  @return {Object} - 匯入結果
     */
    importPlayersFromCSV(csvText) {
        try {
            const lines = csvText.split('\n');
            const importedPlayers = [];
            let skippedCount = 0;
            // 跳過標題行，從第二行開始處理
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                // 解析 CSV 行，處理可能包含逗號的欄位
                const columns = this.parseCSVLine(line);
                if (columns.length >= 3) {
                    const name = columns[0].trim().replace(/"/g, ''); // 移除引號
                    const status = columns[2].trim().replace(/"/g, ''); // C 欄位是狀態
                    // 如果狀態不是"候補"，則匯入該球員
                    if (status !== '候補' && name) {
                        // 檢查是否已存在相同姓名的球員
                        if (!this.players.find(p => p.name === name)) {
                            const player = this.addPlayer(name, 1); // 預設為綠色等級
                            if (player) {
                                importedPlayers.push(name);
                            }
                        } else {
                            skippedCount++;
                        }
                    }
                }
            }
            return {
                success: true,
                importedCount: importedPlayers.length,
                skippedCount: skippedCount,
                importedPlayers: importedPlayers
            };
        } catch (error) {
            console.error('匯入 CSV 球員時發生錯誤:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },
    /**
     *  解析 CSV 行，處理包含逗號的欄位
     *  @param {String} line - CSV 行
     *  @return {Array} - 解析後的欄位陣列
     */
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    },
    /**
     *  回傳資料
     */
    print() {
        console.log(JSON.stringify(this, null, 4));
    },
    /**
     *  透過 Google Apps Script 從 Google Sheet 匯入球員
     *  @param {String} sheetTabName - Google Sheet 頁籤名稱
     *  @param {String} scriptUrl - Google Apps Script Web App URL
     *  @return {Promise} - 匯入結果
     */
    async importPlayersFromSheetViaAppsScript(sheetTabName, scriptUrl) {
        try {
            const url = `${scriptUrl}?sheetTabName=${encodeURIComponent(sheetTabName)}`;
            const response = await fetch(url, {
                method: 'GET'
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '未知錯誤');
            }
            // 處理匯入的資料
            const importedPlayers = [];
            let skippedCount = 0;
            for (let playerData of result.data) {
                let name = playerData.name;
                let status = playerData.status;
                if (status == '候補') {
                    continue;
                }
                // 檢查是否已存在相同姓名的球員
                if (!this.players.find(p => p.name === name)) {
                    let player = this.addPlayer(name, 1); // 預設為綠色等級
                    if (player) {
                        importedPlayers.push(name);
                    }
                } else {
                    skippedCount++;
                }
            }
            return {
                success: true,
                importedCount: importedPlayers.length,
                skippedCount: skippedCount,
                importedPlayers: importedPlayers,
                totalAvailable: result.totalCount
            };
        } catch (error) {
            console.error('透過 Apps Script 匯入球員時發生錯誤:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },
};
$(document).ready(() => {
    const model = localStorage.getItem("model")
    if (model) {
        const data = JSON.parse(model);
        GAME.players = data.players;
        GAME.courts = data.courts;
        GAME.gameHistory = data.gameHistory;
        
        // 恢復進行中的比賽計時器
        GAME.courts.forEach(court => {
            if (court.status === COURT_STATUS.IN_USE) {
                // 如果場地正在使用中，重新開始計時器
                // 注意：這裡只是為了顯示，實際時間會從載入時開始計算
                GAME.startGameTimer(court.id);
            }
        });
    }
    $('#addPlayerBtn').on('click', () => {
        $('#playerNameInput').val('');
        $('#playerLevelSelect').val('1');
        $('#addPlayerModal').show();
    });
    window.closeAddPlayerModal = function() {
        $('#addPlayerModal').hide();
    };
    // 匯入球員按鈕
    $('#importPlayersBtn').on('click', () => {
        $('#appsScriptTabInput').val('');
        $('#csvInput').val('');
        $('#importStatus').hide();
        $('#importPlayersModal').show();
    });
    window.closeImportPlayersModal = function() {
        $('#importPlayersModal').hide();
    };
    // 切換匯入方式
    $('input[name="importMethod"]').on('change', function() {
        var method = $(this).val();
        if (method === 'appsScript') {
            $('#appsScriptImportSection').show();
            $('#csvImportSection').hide();
        } else {
            $('#appsScriptImportSection').hide();
            $('#csvImportSection').show();
        }
    });
    // 確定匯入球員
    $('#confirmImportPlayersBtn').on('click', async () => {
        var importMethod = $('input[name="importMethod"]:checked').val();
        // 顯示載入狀態
        $('#importStatus').show();
        $('#importMessage').text('正在匯入球員...');
        $('#confirmImportPlayersBtn').prop('disabled', true);
        try {
            var result;
            if (importMethod === 'appsScript') {
                var sheetTabName = $('#appsScriptTabInput').val();
                if (!sheetTabName) {
                    alert('請輸入頁籤名稱');
                    $('#confirmImportPlayersBtn').prop('disabled', false);
                    return;
                }
                // 直接使用設定的 Google Apps Script URL
                result = await GAME.importPlayersFromSheetViaAppsScript(sheetTabName, GOOGLE_APPS_SCRIPT_URL);
            } else {
                var csvText = $('#csvInput').val();
                if (!csvText) {
                    alert('請輸入 CSV 資料');
                    $('#confirmImportPlayersBtn').prop('disabled', false);
                    return;
                }
                result = GAME.importPlayersFromCSV(csvText);
            }
            if (result.success) {
                var message = `匯入完成！\n成功匯入 ${result.importedCount} 名球員\n跳過 ${result.skippedCount} 名重複球員`;
                if (result.importedPlayers.length > 0) {
                    message += `\n匯入的球員：${result.importedPlayers.join(', ')}`;
                }
                if (result.totalAvailable) {
                    message += `\n總共可匯入：${result.totalAvailable} 名球員`;
                }
                $('#importMessage').text(message);
                // 更新畫面並儲存資料
                renderPlayers();
                saveData();
                // 3秒後關閉 modal
                setTimeout(() => {
                    closeImportPlayersModal();
                }, 3000);
            } else {
                $('#importMessage').text(`匯入失敗：${result.error}`);
            }
        } catch (error) {
            $('#importMessage').text(`匯入失敗：${error.message}`);
        } finally {
            $('#confirmImportPlayersBtn').prop('disabled', false);
        }
    });
    // 确定新增球员
    $('#confirmAddPlayerBtn').on('click', () => {
        var playerName = $('#playerNameInput').val();
        var playerLevel = $('#playerLevelSelect').val();
        if (playerName && playerLevel) {
            GAME.addPlayer(playerName, parseInt(playerLevel));
            renderPlayers();
            saveData();
            closeAddPlayerModal();
        } else {
            alert('請輸入球員姓名並選擇分級');
        }
    });
    // 新增場地按鈕
    $('#addCourtBtn').on('click', () => {
        GAME.addCourt();
        renderCourts();
        saveData();
    });
    // 刪除球員按鈕
    $('#removePlayerBtn').on('click', () => {
        var playerName = prompt('請輸入要移除的球員姓名:');
        if (playerName) {
            GAME.removePlayer(playerName);
            renderPlayers();
            saveData();
        }
    });
    // 刪除空場地按鈕
    $('#removeCourtBtn').on('click', () => {
        GAME.removeEmptyCourt();
        renderCourts();
        saveData();
    });
    // 重置所有玩家紀錄按鈕
    $('#resetRecordBtn').on('click', () => {
        GAME.resetRecord();
        renderPlayers();
        saveData();
    });
    // 清除所有玩家按鈕
    $('#resetPeopleBtn').on('click', () => {
        GAME.resetPeople();
        renderPlayers();
        saveData();
    });
    // 清除所有場地按鈕
    $('#resetCourtBtn').on('click', () => {
        GAME.resetCourt();
        renderCourts();
        saveData();
    });
    // 增加上場次數
    $(document).on('click', '.incrementBtn', function() {
        const playerName = $(this).data('player-name');
        const player = GAME.players.find(p => p.name === playerName);
        if (player) {
            player.playCount++;
            $(this).siblings('span').find('.playCount').text(player.playCount);
            saveData();
        }
    });
    // 減少上場次數
    $(document).on('click', '.decrementBtn', function() {
        const playerName = $(this).data('player-name');
        const player = GAME.players.find(p => p.name === playerName);
        if (player && player.playCount > 0) {
            player.playCount--;
            $(this).siblings('span').find('.playCount').text(player.playCount);
            saveData();
        }
    });
    // 儲存資料
    function saveData() {
        localStorage.setItem("model", JSON.stringify(GAME));
    }
    // 繪製球員
    function renderPlayers() {
        $('#playersList').empty();
        GAME.players.forEach((player, index) => {
            const $playerItem = $(`
                <li class="player-background-${player.level}">
                    <span class="player-number">${index + 1}.</span>
                    <button class="decrementBtn" data-player-name="${player.name}">-</button>
                    <span>
                        ${player.name} (上場次數: <a class="playCount">${player.playCount}</a>)
                    </span>
                    <button class="incrementBtn" data-player-name="${player.name}">+</button>
                    <button class="restBtn ${player.status == PLAYER_STATUS.REST ? 'resting' : ''}" data-player-name="${player.name}">
                        ${player.status == PLAYER_STATUS.REST ? '不排場' : '休息'}
                    </button>
                    <button class="colorBtn" data-player-name="${player.name}" data-current-level="${player.level}">
                        <span class="color-indicator color-${player.level}">●</span>
                    </button>
                    <button class="deleteBtn" data-player-name="${player.name}"> 刪除 </button>
                    <button class="cleanBtn" data-player-name="${player.name}"> 重置狀態 </button>
                </li>
            `);
            $('#playersList').append($playerItem);
        });
    }
    // 繪製場地
    function renderCourts() {
        $('#courtsList').empty();
        const sortedCourts = GAME.courts.sort((a, b) => a.courtName.localeCompare(b.courtName));
        sortedCourts.forEach((court) => {
            const playerNames = court.players.map((p) => p.name).join(', ');
            // 根据 courtName 分配颜色类
        let courtClass = '';
        if (court.id > 5) {
            courtClass = 'court-random'; // 随机颜色
        } else {
            courtClass = 'court-' + court.courtName;
        }
        // 判斷場地是否未確認（有玩家但狀態為 ASSIGN）
        const isUnconfirmed = court.players.length > 0 && court.status === COURT_STATUS.ASSIGN;
        const courtUnconfirmedClass = isUnconfirmed ? 'unconfirmed' : '';
        const gridUnconfirmedClass = isUnconfirmed ? 'unconfirmed' : '';
        // 判斷確認按鈕是否已確認
        const assuranceBtnClass = court.status === COURT_STATUS.IN_USE ? 'confirmed' : '';
        const courtElement = $(`
                <li class="${courtClass}">
                    <div class="court-header">
                        <p>${court.courtName} (場地 ${court.id})</p>
                        <div class="game-timer" id="court-${court.id}-timer"></div>
                    </div>
                    <a class="assignBtn" data-court-id="${court.id}">分隊</a>
                    <a class="assuranceBtn ${assuranceBtnClass}" data-court-id="${court.id}">確定</a>
                    <div class="court ${courtUnconfirmedClass}">
                        <div class="court-grid ${gridUnconfirmedClass}">
                            ${court.players.map((p, i) => `<div class="player player${i + 1} player-background-${p.level}">${p.name}</div>`).join('')}
                        </div>
                        <a class="finishGameBtn" data-court-id="${court.id}">比賽結束</a>
                    </div>
                </li>
            `);
            $('#courtsList').append(courtElement);
        });
        $('.finishGameBtn').off('click').on('click', function() {
            const courtId = $(this).data('court-id');
            var court = GAME.courts.find(c => c.id == courtId);
            if (court.status == COURT_STATUS.IN_USE) {
                if(confirm('確定要結束比賽? 請確認點擊正確')) {
                    GAME.gameFinish(courtId);
                    renderCourts();
                    renderPlayers();
                    saveData();
                }
            } else {
                alert('請按下確認鍵');
            }
        });
        //分隊
        $('.assignBtn').off('click').on('click', function() {
            const courtId = $(this).data('court-id');
            var court = GAME.courts.find(c => c.id == courtId);
            if (court.status < COURT_STATUS.IN_USE) {
                court.status = COURT_STATUS.ASSIGN;// 派遣隊伍中
                var players = court.players.splice(0);
                // players.forEach(p => p.isPlaying = false);
                // 重置計時器
                GAME.stopGameTimer(courtId);
                GAME.nextGame(courtId);
                renderCourts();
                renderPlayers();
            } else {
                alert('已確認隊伍 無法更動');
            }
        });
        //確認隊伍
        $('.assuranceBtn').off('click').on('click', function() {
            const courtId = $(this).data('court-id');
            const court = GAME.courts.find(c => c.id === courtId);
            if (court.status == COURT_STATUS.ASSIGN && court.players.length == 4) {
                court.status = COURT_STATUS.IN_USE; // 場地使用中
                // var players = court.players.splice(0);
                court.players.forEach(player => {
                    player.status = PLAYER_STATUS.PLAY;
                    player.playCount++;
                });
                // 開始計時
                GAME.startGameTimer(courtId);
                renderCourts();
                renderPlayers();
                saveData();
            } else {
                if (court.players.length < 4) {
                    alert('未滿四個人，無法組成隊伍');
                } else {
                    alert('已確認');
                }
            }
        });
    }
    $(document).on('click', '.restBtn', function () {
        const playerName = $(this).data('player-name');
        const player = GAME.players.find(p => p.name === playerName);
        if (player.status == PLAYER_STATUS.REST) {
            player.status = PLAYER_STATUS.WAIT;
            $(this).text('休息');
            $(this).toggleClass('resting', player.status);
        } else if (player.status == PLAYER_STATUS.WAIT) {
            player.status = PLAYER_STATUS.REST;
            $(this).text('不排場');
            $(this).toggleClass('resting', player.status);
        } else {
            alert('比賽中無法更動狀態');
            return;
        }
        saveData();
    });
    $(document).on('click', '.deleteBtn', function () {
        const playerName = $(this).data('player-name');
        const player = GAME.players.find(p => p.name === playerName);
        if (player.status == PLAYER_STATUS.REST || player.status == PLAYER_STATUS.WAIT) {
            if(confirm('確定要刪除' + playerName + '?')) {
                if(GAME.removePlayer(playerName)) {
                    renderPlayers();
                    saveData();        
                } else {
                    alert('刪除發生問題');
                }
            }
        } else {
            alert('比賽進行中，目前無法刪除');
            return;
        }
        saveData();
    });
    $(document).on('click', '.cleanBtn', function () {
        const playerName = $(this).data('player-name');
        const player = GAME.players.find(p => p.name === playerName);
        player.status = PLAYER_STATUS.REST;
        renderPlayers();
        saveData();        
    });
    // 顏色按鈕點擊事件
    $(document).on('click', '.colorBtn', function () {
        const playerName = $(this).data('player-name');
        const player = GAME.players.find(p => p.name === playerName);
        if (player) {
            // 循環切換顏色等級：1(綠) -> 2(黃) -> 3(紅) -> 4(藍) -> 1(綠)
            player.level = player.level % 4 + 1;
            // 更新按鈕的 data 屬性
            $(this).data('current-level', player.level);
            // 重新渲染球員列表以更新顏色
            renderPlayers();
            saveData();
        }
    });
    // 初始化畫面
    renderPlayers();
    renderCourts();
    GAME.updateGameHistoryDisplay();
});