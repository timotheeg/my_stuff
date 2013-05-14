/*jshint laxbreak:true */

function pad(num, size) {
    var s = "00000000" + num;
    return s.substr(s.length-size);
}

function isPowerOfTwo(x)
{
    return x > 0 && (x & (x - 1)) === 0;
}

function format(template /*, args */) {
	for (i=1;i<arguments.length;i++) {
		template = template.replace('?', arguments[i])
	}
	return template;
}

var tpl_sig_backward = "eval('n=?;s=\"\";do{s=String.fromCharCode((n&?)+?)+s}while(n>>>=?);')";
var tpl_sig_forward = "eval('n=?;s=\"\";do{s+=String.fromCharCode((n&?)+?)}while(n>>>=?);')";


function _getSig(template, word, bits_per_char, base_ascii)
{
	var binary = '';
	for (var idx=word.length; idx--;)
	{
		binary = pad((word.charCodeAt(idx) - base_ascii).toString(2), bits_per_char) + binary;
	}

	var num = parseInt(binary, 2);

	return format(tpl_sig_backward
			, num
			, (1 << bits_per_char) - 1
			, base_ascii
			, bits_per_char
		);
}

function getSigBackward(word, bits_per_char, base_ascii)
{
	return _getSig(tpl_sig_backward, word, bits_per_char, base_ascii);
}

function getSigForward(word, bits_per_char, base_ascii)
{
	return _getSig(tpl_sig_forward, word.split('').reverse().join(''), bits_per_char, base_ascii);
}


var ERR_TOO_LONG = "?: Unable to compute funny sig, character range too broad for word length";


function funnysig(word)
{
	var TOTAL_BITS = 32, idx;

	// find lowest and highest ascii chars
	var min_ascii = Infinity, max_ascii = -Infinity;
	for (idx=word.length; idx--;)
	{
		var code = word.charCodeAt(idx);
		if (code < min_ascii) min_ascii = code;
		if (code > max_ascii) max_ascii = code;
	}

	// we try to get min_ascii translated to become index 0 in our mini range

	// first we check if we are on an exact range
	var required_range = max_ascii - min_ascii + 1;
	var bits_per_char = Math.ceil( Math.log(required_range) / Math.log(2) );

	// exit early if this word cannot be managed
	if (bits_per_char * word.length > TOTAL_BITS)
	{
		throw format(ERR_TOO_LONG, word);
	}

	// now check edge cases:
	// we need to worry about cases where the index 0 is either first or last
	if (word.charCodeAt(0) == min_ascii)
	{
		if (word.charCodeAt(word.length - 1) != min_ascii)
		{
			return getSigForward(word, bits_per_char, min_ascii);
		}
		
		// we have zeros on both end (e.g. "amelia")
		// that means the base needs to be 1 rather than zero
		min_ascii -= 1;

		// check if that means we need an extra bit :(
		if (isPowerOfTwo(required_range))
		{
			bits_per_char += 1;

			// check if can still fit...
			// we know the last character only require 1 bit to work!
			if ((bits_per_char * (word.length - 1)) + 1 > TOTAL_BITS)
			{
				throw format(ERR_TOO_LONG, word);
			}
		}
	}

	return getSigBackward(word, bits_per_char, min_ascii);
}

if ( !process || !process.argv || !process.argv[2] )
{
	console.log("usage: node sig.js <word>");
	process.exit(1);
}
else
{
	console.log( process.argv[2] + ": " + funnysig( process.argv[2] ) );
}
