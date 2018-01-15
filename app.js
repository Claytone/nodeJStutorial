var mongojs = require("mongojs");
var db = mongojs('localhost:27017/myGame', ['account', 'progress']);

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
    
    self.getDistance = function(pt) {
        return Math.sqrt(Math.pow(self.x-pt.x, 2) + Math.pow(self.y-pt.y, 2));
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
	
    self.pressingAttack = false;
	self.mouseAngle = 0;
    self.maxSpd = 10;
    
    //this chunk overrides the update function from Entity
    //so that updateSpd() is called before the standard update
    //triggers
    var regular_update = self.update;
    self.update = function() { 
        self.updateSpd();
        regular_update();
		
		if(self.pressingAttack){
			self.shootBullet(self.mouseAngle);
		}
    }
	
	self.shootBullet = function(angle) {
		var b = Bullet(self.id, angle);
		b.x = self.x;
		b.y = self.y;
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
        else if (data.inputId == 'attack')
            player.pressingAttack = data.state;
        else if (data.inputId == 'mouseAngle') 
            player.mouseAngle = data.state;
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

var Bullet = function(parent, angle) {
    var self = Entity();
    self.id = Math.random(); //override the id with a random id
    self.spdX = Math.cos(angle/180*Math.PI) * 10;
    self.spdY = Math.sin(angle/180*Math.PI) * 10 ;
    self.parent = parent; 
    
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
        
        for (var i in Player.list) {
        var p = Player.list[i];
            if ( self.getDistance(p) < 32 && self.parent != p.id) {
                //handle collision
                self.toRemove = true;
                p.toRemove = true;
            }
        }
    }
    Bullet.list[self.id] = self;
    return self;
}

Bullet.list = {};

Bullet.update = function(){
    
    var pack = [];
    for(var i in Bullet.list){
        var bullet = Bullet.list[i];
        
        bullet.update();
        
        if ( bullet.toRemove) {
            delete Bullet.list[i];
        }
        else {
            pack.push({
                x:bullet.x,
                y:bullet.y,
            });
        }
    }
    return pack; //send the package back to the main loop
}
var DEBUG = true;

var USERS = {
    //username:password
    "bob":"asd",
    "bob2":"asd",
    "bob3":"asd",  
}

var isValidPassword = function(data, cb) {
    db.account.find({username:data.username, password:data.password} ,function(err, res) {
        if (res.length > 0)
            cb(true);
        else
            cb(false);
    });
}

var isUsernameTaken= function(data, cb) {
    db.account.find({username:data.username} ,function(err, res) {
        if (res.length > 0)
            cb(true);
        else
            cb(false);
    });
}

var addUser = function(data, cb) {
    db.account.insert({username:data.username, password:data.password} ,function(err) {
        cb();
    });
}

var io = require('socket.io')(serv,{});
io.sockets.on('connection', function(socket) {
    console.log('Socket connection');
    
    //prepare an ID for the socket
    socket.id = Math.random();
    SOCKET_LIST[socket.id] = socket;
    
    socket.on('signIn', function(data) {
        isValidPassword(data, function(res) {
 
        if (res) {
            //initialize a player connected to that socket
            Player.onConnect(socket);
            socket.emit('signInResponse', {success:true});
        }
        else {
            socket.emit('signInResponse', {success:false});
        }
        });
    });
    
    socket.on('signUp', function(data) {
        isUsernameTaken(data, function(res) {
            if (res) {
                socket.emit('signUpResponse', {success:false});
            }
            else {
                addUser(data, function() {
                    socket.emit('signUpResponse', {success:true});
                });
            }
        });
    });
    

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