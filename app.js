var express = require('express');
var app = express();
var serv = require('http').Server(app);

app.get('/',function(req, res) {
    res.sendFile(__dirname + '/client/index.html');
});
app.use('/client',express.static(__dirname + '/client'));
serv.listen(2000);

console.log("Server started.");

var SOCKET_LIST = {};

var Entity = function(){
    var self = {
        x:250,
        y:250,
        spdX:0,
        spdY:0,
        id:"",
    }
    self.update = function(){
        self.updatePosition();
    }
    self.updatePosition = function(){
        self.x += self.spdX;
        self.y += self.spdY;
    }
    return self;
}

//Player constructor
var Player = function(id /*the socket id for this player*/) { 
    var self = Entity(); //Player is a type of entity
    self.id = id;
    self.number = "" + Math.floor(10*Math.random());
    self.pressingRight = false;
    self.pressingLeft = false;
    self.pressingUp = false;
    self.pressingDown = false;
    self.maxSpd = 10;
    
    //this chunk overrides the update function from Entity
    //so that updateSpd() is called before the standard update
    //triggers
    var regular_update = self.update;
    self.update = function() { 
        self.updateSpd();
        regular_update();
    }
        
    self.updateSpd = function() { //take in control messages
        if (self.pressingRight)
            self.spdX = self.maxSpd;
        else if (self.pressingLeft)
            self.spdX = -self.maxSpd;
        else
            self.spdX = 0;
        
        if (self.pressingUp)
            self.spdY = self.maxSpd;
        else if (self.pressingDown)
            self.spdY = -self.maxSpd;
        else
            self.spdY = 0;
    }
    Player.list[id] = self;
    return self;
}

Player.list = {};

//set up the necessary junk for a newly connected player
Player.onConnect = function(socket) {
    var player = Player(socket.id); //call the Player constructor
    //add listeners for keypress packages to that socket
    socket.on('keypress', function(data) { 
        if (data.inputId == 'left')
            player.pressingLeft = data.state;
        else if (data.inputId == 'up')
            player.pressingUp = data.state;
        else if (data.inputId == 'right')
            player.pressingRight = data.state;
        else if (data.inputId == 'down')
            player.pressingDown = data.state;
    });
}

Player.onDisconnect = function(socket) {
    delete Player.list[socket.id];
}

//iterate through each player, update their speeds and positions, 
//and push all of that info into a package
Player.update = function(){
    var pack = [];
    for(var i in Player.list){
        var player = Player.list[i];
        
        player.update();
        pack.push({
            x:player.x,
            y:player.y,
            number:player.number
        });
    }
    return pack; //send the package back to the main loop
}

var Bullet = function(angle) {
    var self = Entity();
    self.id = Math.random(); //override the id with a random id
    self.spdX = Math.cos(angle/180*Math.PI) * 10;
    self.spdY = Math.sin(angle/180*Math.PI) * 10 ;
    
    self.timer = 0;
    self.toRemove = false;
    //every time we update, we actually need to 
    //increment the timer so that the bullet eventually dies.
    var super_update = self.update;
    self.update = function() {
        if (self.timer++ > 100) {
            self.toRemove = true;
        }
        super_update();
    }
    Bullet.list[self.id] = self;
    return self;
}

Bullet.list = {};

Bullet.update = function(){
    if(Math.random() < 0.1){
        Bullet(Math.random()*360);
    }
    var pack = [];
    for(var i in Bullet.list){
        var bullet = Bullet.list[i];
        
        bullet.update();
        pack.push({
            x:bullet.x,
            y:bullet.y,
        });
    }
    return pack; //send the package back to the main loop
}
var DEBUG = true;
var io = require('socket.io')(serv,{});
io.sockets.on('connection', function(socket) {
    
    //prepare an ID for the socket
    socket.id = Math.random();
    socket.x = 0;
    socket.y = 0;
    SOCKET_LIST[socket.id] = socket;
    
    //initialize a player connected to that socket
    Player.onConnect(socket);
    console.log('Socket connection');

    socket.on('disconnect', function() {
        delete SOCKET_LIST[socket.id];
        Player.onDisconnect(socket);
    });
    
    socket.on('sendMsgToServer', function(data) {
        var playerName = ("" + socket.id).slice(2, 7);
        for ( var i in SOCKET_LIST) {
            SOCKET_LIST[i].emit('addToChat', playerName + ': ' + data);
        }
    });
    
    socket.on('evalServer', function(data) {
        if ( !DEBUG )
            return;
        var res = eval(data);
        socket.emit('evalAnswer' ,res);
    });
});

setInterval(function() { //main loop of game
    //update all of the players and return a package with their info
    var pack = {
        player:Player.update(),
        bullet:Bullet.update(),
    }
    //emit that package to each connected socket
    for ( var i in SOCKET_LIST) {
        var socket = SOCKET_LIST[i];
        socket.emit('newPositions', pack);
    }
}, 1000/25);