/*jshint laxbreak:true */

function pad(num, size) {
    var s = "00000000" + num;
    return s.substr(s.length-size);
}

function funnysig(word)
{
	var TOTAL_BITS = 32, idx;

	// 1. find lowest and highest ascii range
	var min_ascii = Infinity, max_ascii = -Infinity;
	for (idx=word.length; idx--;)
	{
		var ascii = word.charCodeAt(idx);
		if (ascii < min_ascii) min_ascii = ascii;
		if (ascii > max_ascii) max_ascii = ascii;
	}

	var bits_per_char = Math.ceil( Math.log(max_ascii - min_ascii + 1) / Math.log(2) );

	// 2. check if word can fit
	if (bits_per_char * word.length > TOTAL_BITS)
	{
		throw word + ": unable to compute funny sig, character range too broad for word length";
	}

	// 3. it will fit, computing binary sequence
	var binary = '';
	for (idx=word.length; idx--;)
	{
		binary = pad((word.charCodeAt(idx) - min_ascii + 1).toString(2), bits_per_char) + binary;
	}

	// 4. get 32 bit number representation
	var num = parseInt(binary, 2);

	// 5. return magic formula
	return "eval('n=" + num + ";s=\"\";"
		+ "do{s=String.fromCharCode((n&"
		+ ((1 << bits_per_char) - 1)
		+ ")+"
		+ (min_ascii - 1)
		+ ")+s}while(n>>>="
		+ bits_per_char
		+ ");')";
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
