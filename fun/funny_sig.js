/*jshint laxbreak:true */

// ================================
// Utility functions
// ================================

function pad(num, size) {
    var s = "00000000" + num; // a char is maximum 8 bits, so we harcode 8 zeros for convenience
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



// ================================
// Signature functions
//
// SigWordOrder means that the compressed-range characters in the computed number are 
// in the same order as the ascii-based string
// 
// for example: using "tim" as word
// the signature in word-order will be 2820, or in binary: ['1011', '0000', '0100'], representing ['t', 'i', 'm']
// the signature in reverse-order will be 1035, or in binary: ['0100', '0000', '1011'], representing ['m', 'i', 't']
//
// The order matters because the number is processed sequentially and the last character processed MUST NOT be falsy
// that means the last character evaluated cannot be zero
//
// if only one end of the word is zero, the order is determined easily
// if both ends of the word are zero (e.g. "amelia"), then we must change the base so 'a' is 1 instead of 0 in the new base
// ================================

var tpl_sig_reverse_order  = "eval('n=?;s=\"\";do{s+=String.fromCharCode((n&?)+?)}while(n>>>=?)')";
var tpl_sig_word_order = "eval('n=?;s=\"\";do{s=String.fromCharCode((n&?)+?)+s}while(n>>>=?)')";

function _getSig(sig_template, word, bits_per_char, base_ascii)
{
	var binary = '';
	for (var idx=word.length; idx--;)
	{
		binary = pad((word.charCodeAt(idx) - base_ascii).toString(2), bits_per_char) + binary;
	}

	var num = parseInt(binary, 2);

	return format(sig_template
			, num
			, (1 << bits_per_char) - 1
			, base_ascii
			, bits_per_char
		);
}

function getSigWordOrder(word, bits_per_char, base_ascii)
{
	return _getSig(tpl_sig_word_order, word, bits_per_char, base_ascii);
}

function getSigReverseOrder(word, bits_per_char, base_ascii)
{
	return _getSig(tpl_sig_reverse_order, word.split('').reverse().join(''), bits_per_char, base_ascii);
}


var ERR_TOO_LONG = "?: Unable to compute funny sig, character range too broad for word length";


// ================================
// Main algorithm
// ================================

function funnysig(word)
{
	var TOTAL_BITS = 32, idx;

	// find lowest and highest ascii codes
	var min_ascii = Infinity, max_ascii = -Infinity;
	for (idx=word.length; idx--;)
	{
		var code = word.charCodeAt(idx);
		if (code < min_ascii) min_ascii = code;
		if (code > max_ascii) max_ascii = code;
	}

	// also get ascii codes for first and last chars
	var first_ascii = word.charCodeAt(0);
	var last_ascii = word.charCodeAt(word.length - 1);

	// if both ends of the word are min_ascii (that means will get transposed to char 0 (==falsy)),
	// then we NEED to decrease min_ascii by 1, so the chars will get transposed to 1 and be truthy
	// e.g. "amelia"
	if (first_ascii === min_ascii && last_ascii === last_ascii)
	{
		min_ascii -= 1;
	}

	var required_range = max_ascii - min_ascii + 1;
	var bits_per_char = Math.ceil( Math.log(required_range) / Math.log(2) );
	var num_chars_allowed = Math.floor(TOTAL_BITS / bits_per_char);

	if (word.length > num_chars_allowed + 1)
	{
		// a full extra character is needed, impossible to match
		throw format(ERR_TOO_LONG, word);
	}
	
	if (word.length > num_chars_allowed)
	{
		// we are only missing a single character!
		// see if we can make use of the extra bits to squeeze it in!

		var extra_bits = TOTAL_BITS % bits_per_char;
		var first_char_binary = (first_ascii - min_ascii).toString(2);
		var last_char_binary = (last_ascii - min_ascii).toString(2);

		if (first_char_binary.length <= extra_bits && first_char_binary !== '0')
		{
			return getSigWordOrder(word, bits_per_char, min_ascii);
		}
		
		if (last_char_binary.length <= extra_bits && last_char_binary !== '0')
		{
			return getSigReverseOrder(word, bits_per_char, min_ascii);
		}

		throw format(ERR_TOO_LONG, word);
	}

	// if we reach here, we can always fit the word, yeah!
	if (first_ascii === min_ascii)
	{
		return getSigReverseOrder(word, bits_per_char, min_ascii);
	}

	return getSigWordOrder(word, bits_per_char, min_ascii);
}


// ================================
// process starts here!
// ================================

if ( !process || !process.argv || !process.argv[2] )
{
	console.log("usage: node sig.js <word>");
	process.exit(1);
}
else
{
	try
	{
		var sig = funnysig( process.argv[2] );
	}
	catch(e)
	{
		console.log(e);
		process.exit(1);
	}

	console.log( process.argv[2] + ": " + sig + ' -> '  + eval(sig));
	process.exit(0);
}
