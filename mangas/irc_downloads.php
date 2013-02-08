<?php

define("CRLF", "\n\r");

$server_host = "irc.irchighway.net";
$server_port = 6667;
$server_chan = "#lurk";
$bot_name = "Mirrors";

$nickname = "timothee";
$password = "XXXXX";
$greetingMsg = "yo!";
$partingMsg = "A+!";

/*
 * command line parameters as follow:
 * h: host
 * p: port
 * c: channel
 * b: bot
 * n: nickname
 * w: password
 * g: greeting (optional)
 * q: parting (optional)
 * f: file list (pack #)
*/

$opts = getopt('h:p:c:b:n:w:g::q::f:');

if (!$opts)
{
	echo "Parameters invalid or missing!\n";
	exit();
}

if (isset($opts['h'])) $server_host = $opts['h'];
if (isset($opts['p'])) $server_port = $opts['p'];
if (isset($opts['c'])) $server_chan = $opts['c'];
if ($server_chan[0] != '#') $server_chan = "#$server_chan";
if (isset($opts['b'])) $bot_name = $opts['b'];

if (isset($opts['n'])) $nickname = $opts['n'];
if (isset($opts['w'])) $password = $opts['w'];
if (isset($opts['g'])) $greetingMsg = $opts['g'];
if (isset($opts['q'])) $partingMsg = $opts['q'];

$connected = false;
$curAction = null;

$server = array
(
	  'SOCKET' => null
	, '_DCC'   => null
	, 'DCC'    => null
);

$actions = array
(
	  array("WAIT", 5)
	, array("MSG", "PRIVMSG $server_chan :$greetingMsg")
	, array("WAIT", 60)
);

// compute package list to download
$wanted = array();
foreach(explode(',', $opts['f']) as $block)
{
	$matches = array();
	if (preg_match('/^([0-9]+)(-([0-9]+))?$/', trim($block), $matches))
	{
		if (count($matches) == 2)
		{
			$wanted[] = (int) $block;
		}
		else
		{
			$start = (int) $matches[1];
			$end = (int) $matches[3];
			if ($start == $end)
			{
				$wanted[] = $start;
			}
			else if ($start < $end)
			{
				$wanted = array_merge($wanted, range($start, $end));
			}
			else
			{
				// range is invalid
			}
		}
	}
}

// remove potential duplicates packages
foreach(array_unique($wanted) as $num)
{
	$actions[] = array("GET", $num);
}

// add goodbye action
$actions[] = array("MSG", "PRIVMSG $server_chan :$partingMsg");

// Open the socket connection to the IRC server 
$server['SOCKET'] = @fsockopen($server_host, $server_port, $errno, $errstr, 2);
if(!$server['SOCKET']) DIE ("unable to connect to irc server");

stream_set_blocking($server['SOCKET'], 0);

// Ok, we have connected to the server, now we have to send the login commands.
SendCommand("PASS $password"); // sends the password not needed for most servers
SendCommand("NICK $nickname"); // sends the nickname 
SendCommand("USER $nickname USING PHP IRC"); // sends the user must have 4 paramters

while(1) // while we are connected to the server 
{
	$sockets = array($server['SOCKET']);
	if (isset($server['DCC']['socket'])) $sockets[] = $server['DCC']['socket'];
	
	$null = null;
	stream_select($sockets, $null, $null, 1);
	
	$server['READ_BUFFER'] = trim(fgets($server['SOCKET'], 2048)); // get a line of data from the server
	if (!empty($server['READ_BUFFER'])) echo "[RECEIVE] {$server['READ_BUFFER']}\n"; // display the received data from the server
	
	// always handle pings first
	if(substr($server['READ_BUFFER'], 0, 6) == "PING :") // if the server has sent the ping command 
	{ 
		SendCommand("PONG :".substr($server['READ_BUFFER'], 6)); // reply with pong 
	}
	
	$matches = array();
	if (preg_match("/^(\\S+)\\s+(\\d+)/", $server['READ_BUFFER'], $matches))
	{
		switch ($matches[2])
		{
			case "376": /* connected to server, all welcome messages received */
				SendCommand("JOIN $server_chan"); // Join the chanel
				break;
				
			case "366": /* member list for channel received */
				$connected = true;
				break;
		}
	}
	else if (preg_match("/NOTICE $nickname.+Punish-ignore.+$nickname.+ (\\d+) minutes/i", $server['READ_BUFFER'], $matches))
	{
		echo "[WARNING] punish action received, stopping downloads for {$matches[1]} minutes\n";
		
		if ($curAction)
		{
			array_unshift($actions, $curAction);
			$curAction = null;
		}
		
		if ($server['DCC'])
		{
			if ($server['DCC']['socket']) fclose($server['DCC']['socket']);
			if ($server['DCC']['file']) fclose($server['DCC']['file']);
			$server['DCC'] = null;
		}
		
		$punition = ((int) $matches[1]) * 60 + 10; // +10 second buffer to be sure the punition time is expired
		
		// honour punition via a wait action
		if ($actions[0][0] == "WAIT")
		{
			if ($punition > $actions[0][1])
			{
				$actions[0][1] = $punition;
			}
		}
		else
		{
			array_unshift($actions, array("WAIT", $punition));
		}
	}
	
	if (!$connected) continue;
	
	// connected, check if any action must be taken
	if ($curAction)
	{
		switch ($curAction[0])
		{
			case "WAIT":
				if (time() <= $curAction[1]) break;
				$curAction = null;
				break;
		
			case "GET":
				// are we currently downloading?
				if ($server['DCC'])
				{
					// read and save file data
					if (!feof($server['DCC']['socket']))
					{
						$fileChunk = fgets($server['DCC']['socket'], 2048);
						if ($fileChunk != "")
						{
							$server['DCC']['downloaded'] += strlen($fileChunk);
							fwrite($server['DCC']['file'], $fileChunk);
							
							$filesize = filesize($server['DCC']['filename']);
							
							// echo "[DCC NOTICE] {$server['DCC']['downloaded']} / {$server['DCC']['todownload']} - " . (100 * $server['DCC']['downloaded'] / $server['DCC']['todownload']) . " - $filesize / {$server['DCC']['size']} - " . (100 * $filesize / $server['DCC']['size']) . "\n";
							
							// erm, assumes downloaded data has been written to file properly...
							if ($server['DCC']['downloaded'] < $server['DCC']['todownload'])
							{
								break;
							}
							
							// downloads is complete, somehow we are supposed to notify server here :/
							// where is the bloody doc!!!?!?
							
							/*
							echo "[DCC NOTICE] download is complete, waiting for notification from server\n";
							break;
							/**/
						}
						else
						{
							break;
						}
					}
					
					// download presumably complete, close all file/socket handles
					fclose($server['DCC']['socket']);
					fclose($server['DCC']['file']);
					
					// ensures we get an appropriate reading on the file size
					clearstatcache();
					
					if (filesize($server['DCC']['filename']) > $server['DCC']['size'])
					{
						echo "[DCC ERROR] incorrect file size for pack #{$curAction[1]} ({$server['DCC']['filename']})\n";
					}
					else if (filesize($server['DCC']['filename']) < $server['DCC']['size'])
					{
						echo "[DCC WARNING] pack #{$curAction[1]} is NOT downloaded completely ({$server['DCC']['filename']})\n";
						echo "[DCC WARNING] waiting 5 seconds before taking next step\n";
						array_unshift($actions, array("WAIT", 5), $curAction);
					}
					else
					{
						echo "[DCC NOTICE] pack #{$curAction[1]} download complete ({$server['DCC']['filename']})\n";
					}
					
					$server['DCC'] = null;
					$curAction = null;
					
					// check eventual commands that may break the connection
					// in particular penalty time for slow connections for example (we must in such case
					// unshift a WAIT action to the actions array
					// and add support for download resume of course :/
					// TODO!
				}
				else
				{
					if (empty($server['READ_BUFFER'])) break;
					
					// DCC not started yet, proceed with handshake
					$matches = array();
					if (
						preg_match("/PRIVMSG $nickname/i", $server['READ_BUFFER']) && 
						preg_match("/DCC SEND (\\S+) (\\d+) (\\d+) (\\d+)/i", $server['READ_BUFFER'], $matches)
					)
					{
						echo "[DCC NOTICE] SEND message detected\n";
						print_r($matches); // for debug only
						echo "\n";
					
						$server['_DCC'] = null;
						
						$server['DCC'] = array(
							'filename' => $matches[1],
							'ip' => long2ip($matches[2]),
							'port' => (int)$matches[3],
							'size' => (int)$matches[4],
							'todownload' => (int)$matches[4],
							'downloaded' => 0
						);
						
						clearstatcache(); // ensure appropriate reading on the file size
						
						if (file_exists($server['DCC']['filename']))
						{
							if (filesize($server['DCC']['filename']) >= $server['DCC']['size'])
							{
								// file already downloaded
								echo "[DCC NOTICE] pack #{$curAction[1]} is already downloaded ({$server['DCC']['filename']})\n";
								SendCommand("PRIVMSG $bot_name :XDCC CANCEL");
								// SendCommand("PRIVMSG $bot_name :XDCC REMOVE {$curAction[1]}"); // NO NEED to do both
								
								$server['DCC'] = null;
								$curAction = null;
								
								break;
							}
							else
							{
								// initiate resume
								echo "[DCC NOTICE] pack #{$curAction[1]} is partially downloaded. Attempting resume. ({$server['DCC']['filename']})\n";
								SendCommand("PRIVMSG $bot_name :DCC RESUME {$server['DCC']['filename']} {$server['DCC']['port']} " . filesize($server['DCC']['filename']) . "");
								$server['_DCC'] = $server['DCC'];
								$server['DCC'] = null;
								break;
							}
						}
					}
					else if (
						   preg_match("/PRIVMSG $nickname/i", $server['READ_BUFFER'])
						&& preg_match("/DCC ACCEPT (\\S+) (\\d+) (\\d+)/", $server['READ_BUFFER'], $matches)
						&& isset($server['_DCC'])
					)
					{
						// resume accepted
						$server['DCC'] = $server['_DCC'];
						$server['_DCC'] = null;
						
						echo "[DCC NOTICE] Resume accepted for pack #{$curAction[1]} ({$server['DCC']['filename']})\n";
						
						$server['DCC']['port'] = (int)$matches[2];
						$server['DCC']['todownload'] -= (int)$matches[3];
					}
					else 
					{
						// non-parsable command, we do nothing
						break;
					}
						
					echo("[DCC NOTICE] Getting pack #{$curAction[1]} ({$server['DCC']['filename']})\n");
					echo("[DCC NOTICE] Connecting to {$server['DCC']['ip']} on port {$server['DCC']['port']} (downloading {$server['DCC']['todownload']} bytes)\n");
					
					// connect to download socket
					$server['DCC']['socket'] = fsockopen($server['DCC']['ip'], $server['DCC']['port'], $errno, $errstr, 30);
					if (!$server['DCC']['socket'])
					{
						// unable to connect to server to download, we skip this item
						echo ("[DCC ERROR] unable to fetch pack #{$curAction[1]} ({$server['DCC']['filename']})\n\t-> $errstr ($errno)");
						$server['_DCC'] = null;
						$server['DCC'] = null;
						$curAction = null;
					}
					
					// connected to stream
					stream_set_blocking($server['DCC']['socket'], 0);
					
					// open local target file
					$server['DCC']['file'] = fopen($server['DCC']['filename'], 'a');
					if (!$server['DCC']['file'])
					{
						echo ("[DCC ERROR] unable to open file for writing ({$server['DCC']['filename']})");
						
						fclose($server['DCC']['socket']);
						SendCommand("PRIVMSG $bot_name :XDCC CANCEL");
						SendCommand("PRIVMSG $bot_name :XDCC REMOVE");
						SendCommand("PRIVMSG $bot_name :XDCC REMOVE {$curAction[1]}");
						
						$server['DCC'] = null;
						$curAction = null;
					}
				}
				break;
		}
	}
	
	if (is_null($curAction) && count($actions) > 0)
	{
		$curAction = array_shift($actions);
		switch ($curAction[0])
		{
			case "WAIT":
				echo "[WAITING] {$curAction[1]} seconds\n";
				$curAction[1] = time() + $curAction[1];
				break;
			
			case "MSG":
				SendCommand($curAction[1]);
				$curAction = null;
				break;
			
			case "GET":
				SendCommand("PRIVMSG $bot_name :XDCC SEND $curAction[1]");
				break;
		}
	}
	else if (is_null($curAction) && count($actions) <= 0)
	{
		break;
	}
	
	flush(); // This flushes the output buffer forcing the text in the while loop to be displayed "On demand"
}

fclose($server['SOCKET']);


function SendCommand ($cmd) 
{
	global $server; // extends our $server array to this function 

	if (substr($cmd, -2) != CRLF) $cmd .= CRLF;

	@fwrite($server['SOCKET'], $cmd, strlen($cmd)); // sends the command to the server 

	echo "[SEND] $cmd"; // displays it on stdout
}
