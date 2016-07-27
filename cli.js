const _ = require('lodash');
const q = require('q');
const qash = require('qash');
const path = require('path');
const sq = require('shell-quote');
const fs = require('fs');

module.exports = cli;

const cmds = [];

cli.execString = execString;
cli.execArgs = executeTokens;
cli.source = script => sourceScript({ script });

cli(module, ({register}) => {
	register('help [{group}]', showHelp);
	register('source {script}', sourceScript);
	register('exit', () => process.exit(0));
});

console.error = (...args) => console.log('\x1b[31m', ...args, '\x1b[0m');
console.info = (...args) => console.log('\x1b[32m', ...args, '\x1b[0m');
console.warn = (...args) => console.log('\x1b[33m', ...args, '\x1b[0m');

function showHelp({ group }) {
	if (group === undefined) {
		console.log(`\x1b[3;1mHelp\x1b[0m`);
		console.log('');
	}
	_(cmds)
		.filter(cmd => group === undefined || cmd.group === group)
		.map(({ group, parser }) => ({ group, help: parser.toHelp() }))
		.orderBy(['group', 'help'])
		.groupBy('group')
		.each((items, name) => {
			console.log(`\x1b[3;1m  ${name}  \x1b[0m`);
			_.map(items, 'help').forEach(str => console.log(str));
			console.log('');
		});
}

/* Registration */

function register(group, syntax, func) {
	const parser = qash.spec(syntax);
	cmds.push({ group, func, parser });
	return { register: registerWrap(group) };
}

function registerWrap(group) {
	return (...args) => register(group, ...args);
}

/* Execution */

function executeTokens(tokens) {
	if (tokens.length === 0) {
		return q();
	}
	const parsed = cmds.reduce((res, { func, parser }) => {
		if (res) {
			return res;
		}
		const args = qash.parse(parser, tokens);
		if (args) {
			return { func, args };
		} else {
			return null;
		}
	}, null);
	if (parsed === null) {
		throw new Error('Invalid command: ' + sq.quote(tokens));
	}
	return q.try(() => parsed.func(_.fromPairs([...parsed.args])));
}

function execString(str) {
	return executeTokens(sq.parse(str));
}

/* Script running */

function Script() {
	let next = q();
	let count = 0;
	let ran = 0;
	this.linesRan = 0;
	this.linesTotal = 0;
	this.errors = [];
	const raise = error => {
		this.errors.push(error);
		if (process.stdin.isTTY) {
			console.error(error);
			return q.reject(error);
		} else {
			throw error;
		}
	};
	this.run = line => {
		const number = ++count;
		this.linesTotal = number;
		const args = _.reject(sq.parse(line, process.env), arg => _.has(arg, 'comment'));
		if (!_.every(args, _.isString)) {
			const new_err = raise(new Error(`Invalid token found in line #${number}`));
			new_err.number = number;
			new_err.line = line;
			return raise(new_err);
		}
		if (args.length === 0) {
			next = next
				.finally(() => this.linesRan = ++ran);
		} else {
			next = next.then(() => executeTokens(args)
				.finally(() => this.linesRan = ++ran)
				.then(() => console.info(`Success: ${line}`),
					err => {
						console.error(`Failed: ${line}`);
						const new_err = new Error(`Error on line #${number}: ${err.message}`);
						new_err.original = err;
						new_err.number = number;
						new_err.line = line;
						return raise(new_err);
					}));
		}
		return next;
	};
	this.done = () => next;
}

function runArgs() {
	const [, , ...args] = [...process.argv];
	if (args.length === 0) {
		args.push('help');
	}
	executeTokens(args)
		.then(
			() => console.info('Success: ' + args.join(' ')),
			err => {
				console.error(err);
				process.exit(255);
			})
		.finally(() => process.exit(0))
		.done();
}

function runTerminal() {
	const rl = require('readline').createInterface({
		input: process.stdin,
		output: process.stdout
	});
	const script = new Script();
	rl.prompt();
	rl.on('line', line => script.run(line).finally(() => rl.prompt()));
	rl.on('close', () => shellWrap(script.done()));
}

function sourceScript({ script }) {
	const runner = new Script();
	const lines = fs.readFileSync(script, { encoding: 'utf-8' }).split(/\n/g);
	for (const line of lines) {
		runner.run(line);
	}
	return runner.done();
}

/* Wrap a resulting promise for top-level CLI handling */

function shellWrap(promise) {
	promise
		.then(() => 0, () => 255)
		.then(code => process.exit(code))
		.done();
}

function cli(module, func) {
	if (arguments.length > 0) {
		const group = path.parse(module.filename).name;
		func({ register: registerWrap(group) });
	}

	if (arguments.length === 0 || !module.parent) {
		global.cli = module;
		if (process.argv.length === 3 && process.argv[2] === '-') {
			setTimeout(runTerminal, 0);
		} else if (process.argv.length === 3 && fs.existsSync(process.argv[2])) {
			setTimeout(() =>
				shellWrap(sourceScript({ script: process.argv[2] })), 0);
		} else {
			setTimeout(runArgs, 0);
		}
	}
}
