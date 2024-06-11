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
        },
    ]
    */
    players: [],
    standBy: [], // 新增standBy陣列來存放暫時休息的玩家
    gameHistory: [],

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
            id: this.courts.length == 0 ? 0 : (this.courts.sort((a, b) => b.id - a.id)[0].id + 1),
            players: [],
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
            var players = court.players.splice(0);
            players.forEach(p => p.isPlaying = false);
            // 添加比賽歷程記錄
            var playerNames = players.map(p => p.name).join(', ');
            this.gameHistory.push(playerNames);
            this.updateGameHistoryDisplay();
            return players;
        } else {
            console.log('court index error', courtIndex);
            return [];
        }
    },
    /**
     * 更新顯示的玩家列表
     */
    updatePlayerListDisplay() {
        // 假設你的玩家列表是顯示在一個 id 為 playerList 的元素中
        $('#playerList').empty();
        this.players.forEach(player => {
            $('#playerList').append(`<li>${player.name}</li>`);
        });
    },

    /**
     * 更新歷史紀錄列表
     */
    updateGameHistoryDisplay() {
        $('#gameHistoryList').empty();
        this.gameHistory.forEach((record, index) => {
            $('#gameHistoryList').append(`<li>${index + 1}. ${record}</li>`);
        });
    },

    /**
     *  下一輪的遊戲
     *  @return {Court[]} - 回傳本來是空的場，現在被補上玩家的那些場地資料array
     */
    nextGame() {
        return this.courts
            .filter(c => c.players.length == 0) // 空的場
            .filter(court => {                  // 填上玩家的場
                var freePlayers = this.find4Players();

                // 人不夠
                if (freePlayers.length == 0) {
                    return false;
                }

                court.players.push(...freePlayers)
                court.players.forEach((p, i, ary) => {
                    p.isPlaying = true;
                    p.playCount++;

                    var friendIndex = [1, 0, 3, 2][i];
                    p.friends.push(ary[friendIndex].name);

                    var enemies = (i > 1 ? ary.slice(0, 2) : ary.slice(2, 4)).map(e => e.name);
                    p.enemies.push(...enemies)
                });

                console.log('court', court.id, ', players', court.players);

                return true;
            });
    },

    /**
     *  找閒置的玩家, 依玩過的場次少到多排序, 同樣場次玩家會按照隊友對手次數積分來排行
     *  @return {Player[]} - 閒置的玩家
     */
    find4Players() {
        // 雖然一次只能取出四個人, 但是一開始在撈人數的時候直接看最後會需要幾個人, 讓分組時比較多人進來
        var courtCount = this.courts.filter(c => c.players.length == 0).length;
        console.log(this.players);
        var players = this.players
            .filter(p => !p.isPlaying && !this.standBy.includes(p))// 過濾掉正在遊戲中和在standBy中的玩家
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

            // 兩人一隊
        // teams = [[1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8], [1, 9], [1, 10], [1, 11], ...]
        var teams = getCombinationsBy2(players);

        // 兩隊一場比賽
        // var twoTeams = [
        //     [[1, 2], [1, 3]],
        //     [[1, 2], [1, 4]],
        //     [[1, 2], [1, 5]],
        //     [[1, 2], [1, 6]], ...
        // ]
        var twoTeams = getCombinationsBy2(teams);
        var t = twoTeams.length

        // 過濾掉兩邊隊伍有重複人的狀況
        // var twoTeams = [
        //     [[1, 2], [3, 4]],
        //     [[1, 2], [3, 5]],
        //     [[1, 2], [3, 6]],
        //     [[1, 2], [3, 7]], ...
        // ];
        var twoTeams = twoTeams.filter(([team1, team2]) => team1.every(p => !team2.includes(p)))

        console.log(`${players.length}人, ${teams.length}種隊伍, ${twoTeams.length}種比賽可能(未扣除兩邊重複人數前${t})`)

        if (twoTeams.length == 0) {
            return [];
        }

        // 計算每場比賽的分數, 重複隊友加權遠遠大於重複對手
        // 隊友重複過, 一場次加 3 分
        // 對手有打過, 一人次加 1 分
        return twoTeams
            .map(twoTeam => { // twoTeam: [[player1, player2], [player3, player4]]
                var score = 0;

                // 重複隊友(兩隊都是一個人找另一個人)
                var friendScore = 3 * twoTeam.reduce((count, [player1, player2], i) => {
                    return count + player1.friends.filter(f => f == player2.name).length;
                }, 0);

                // 重複對手(只需第一隊的兩個人分別去第二隊找)
                var enemyScore = 1 * twoTeam[0].reduce((count, player) => {
                    return count + player.enemies.filter(e => twoTeam[1].some(p => p.name == e)).length;
                }, 0);

                return {
                    twoTeam,
                    score: friendScore + enemyScore,
                    totalPlayCount: twoTeam.flat().reduce((sum, p) => sum + p.playCount, 0),
                };
            })
            .sort((a, b) => a.score - b.score)                                  // 分數從小排到大
            .filter((obj, i, a) => obj.score == a[0].score)                    // 找出分數最小的那一群
            .sort((a, b) => a.totalPlayCount - b.totalPlayCount)               // 遊玩場次從小排到大
            // .map((obj, i, a) => { console.log(obj.score, obj.totalPlayCount, obj.twoTeam.map(team => team.map(p => p.name))) ;return obj})
            .filter((obj, i, a) => obj.totalPlayCount == a[0].totalPlayCount)   // 找出遊玩場次最少的那一群
            .map(obj => obj.twoTeam)                                            // 只取資料
            .shuffle()[0]                                                       // 隨機取一組
            .flat();
    },

    /**
     *  加玩家
     *  @param {String} playerName - 玩家的名字
     *  @return {Player} - 加入的玩家資料
     */
    addPlayer(playerName) {
        var player = {
            name: playerName,
            playCount: 0,
            isPlaying: false,
            friends: [],
            enemies: [],
            active: true,
        }
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
            return player;
        } else {
            console.log(`Player with name ${playerName} not found.`);
            return null;
        }
    },

     /**
     *  將玩家加入standBy
     *  @param {String} playerName - 玩家的名字
     *  @return {Player} - 被加入standBy的玩家資料
     */
     addStandBy(playerName) {
        const player = this.players.find(p => p.name === playerName);
        if (player) {
            this.standBy.push(player);
            return player;
        } else {
            alert('球員不存在');
            console.log(`Player with name ${playerName} not found.`);
            return null;
        }
    },

    /**
     *  從standBy移除玩家
     *  @param {String} playerName - 玩家的名字
     *  @return {Player} - 被移除standBy的玩家資料
     */
    removeStandBy(playerName) {
        const index = GAME.standBy.findIndex(p => p.name === playerName);
        if (index !== -1) {
            const player = GAME.standBy.splice(index, 1)[0];
            return player;
        } else {
            console.log(`Player with name ${playerName} not found in standBy.`);
            return null;
        }
    },

    /**
     *  重置所有玩家紀錄
     */
     resetRecord() {
        this.players.forEach(player => {
            player.playCount = 0;
            player.friends = [];
            player.enemies = [];
            player.isPlaying = false;
        });
        this.gameHistory = [];
        this.updateGameHistoryDisplay();
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
        this.courts = [];
    },

    /**
     *  回傳資料
     */
    print() {
        console.log(JSON.stringify(this, null, 4));
    },
};

$(document).ready(() => {
    const model = localStorage.getItem("model")
    if (model) {
        const data = JSON.parse(model);
        GAME.players = data.players;
        GAME.courts = data.courts;
        GAME.gameHistory = data.gameHistory;
    }

    // 新增球員按鈕
    $('#addPlayerBtn').on('click', () => {
        const playerName = prompt('請輸入球員姓名:');
        if (playerName) {
            GAME.addPlayer(playerName);
            renderPlayers();
            saveData();
        }
    });

    // 新增場地按鈕
    $('#addCourtBtn').on('click', () => {
        GAME.addCourt();
        renderCourts();
        saveData();
    });

    // 新增休息球員按鈕
    $('#addStandByBtn').on('click', () => {
        const playerName = prompt('請輸入球員姓名:');
        if (playerName) {
            GAME.addStandBy(playerName);
            renderPlayers();
            saveData();
        }
    });

    // 刪除球員按鈕
    $('#removePlayerBtn').on('click', () => {
        const playerName = prompt('請輸入要移除的球員姓名:');
        if (playerName) {
            GAME.removePlayer(playerName);
            renderPlayers();
            saveData();
        }
    });

    // 刪除休息球員按鈕
    // $('#removeStandByBtn').on('click', () => {
    //     const playerName = prompt('請輸入要移除的球員姓名:');
    //     if (playerName) {
    //         GAME.removeStandBy(playerName);
    //         renderPlayers();
    //         saveData();
    //     }
    // });

    // 刪除空場地按鈕
    $('#removeCourtBtn').on('click', () => {
        GAME.removeEmptyCourt();
        renderCourts();
        saveData();
    });

    // 比賽結束按鈕
    // $('#finishGameBtn').on('click', () => {
    //     const courtId = parseInt(prompt('請輸入比賽結束的場地編號:'));
    //     if (!isNaN(courtId)) {
    //         GAME.gameFinish(courtId);
    //         renderCourts();
    //         renderPlayers();
    //         saveData();
    //     }
    // });

    // 下一場比賽按鈕
    $('#nextGameBtn').on('click', () => {
        GAME.nextGame();
        renderCourts();
        renderPlayers();
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

    // 儲存資料
    function saveData() {
        localStorage.setItem("model", JSON.stringify(GAME));
    }

    // 繪製球員
    function renderPlayers() {
        $('#playersList').empty();
        GAME.players.forEach((player) => {
            const isStandBy = GAME.standBy.some(p => p.name === player.name);
            const $playerItem = $(`
                <li>
                    ${player.name} (遊玩次數: ${player.playCount})
                    ${isStandBy ? ` <button class="standByBtn" data-player-name="${player.name}">休息</button>` : ''}
                </li>
            `);
            $('#playersList').append($playerItem);
        });
    }

    // 繪製場地
    function renderCourts() {
        $('#courtsList').empty();
        GAME.courts.forEach((court) => {
            const playerNames = court.players.map((p) => p.name).join(', ');
            const courtElement = $(`
                <li>
                    <p>場地 ${court.id}</p>
                    <div class="court">
                        <div class="court-grid">
                            ${court.players.map((p, i) => `<div class="player player${i + 1}">${p.name}</div>`).join('')}
                        </div>
                        <a class="finishGameBtn" data-court-id="${court.id}">比賽結束</a>
                    </div>
                </li>
            `);
            $('#courtsList').append(courtElement);
        });
    
        $('.finishGameBtn').off('click').on('click', function() {
            const courtId = $(this).data('court-id');
            GAME.gameFinish(courtId);
            GAME.nextGame();
            renderCourts();
            renderPlayers();
            saveData();
        });
    }

    $(document).on('click', '.standByBtn', function() {
        const playerName = $(this).data('player-name');
        GAME.removeStandBy(playerName);
        renderPlayers();
    });

    // 初始化畫面
    renderPlayers();
    renderCourts();
    GAME.updateGameHistoryDisplay();
    GAME.updateStandByDisplay(); // 初始化standBy顯示

});
