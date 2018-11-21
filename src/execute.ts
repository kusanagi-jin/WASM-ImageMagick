import pMap from 'p-map'
import { asCommand, call, MagickInputFile, MagickOutputFile } from '.'
import { CallResult } from './magickApi'
import { asInputFile, isInputFile } from './util'
import { values } from './util/misc'

export type Command = (string | number)[]

export interface ExecuteConfig {
  inputFiles?: MagickInputFile[]
  commands: ExecuteCommand
}

/**
 *
 * Commands could have the following syntaxes:
 *  * array form like `[['convert', 'foo.png', 'bar.gif'], ['identify', 'bar.gif']]`
 *  * just one array: `['convert', 'foo.png', 'bar.gif']`
 *  * command line strings: `['convert foo.png bar.gif', 'idenfity bar.gif']`
 *  * just one string: `'convert foo.png bar.gif'`
 *
 * Also, for command line strings, multiple commands can be specified in the same string separating with new lines:
 *
 * ```js
 * const result = await execute(`
 *   convert rose: -sharpen 0x1 reconstruct.jpg
 *   compare rose: reconstruct.jpg difference.png
 *   compare -compose src rose: reconstruct.jpg difference.png
 * `)
 * ```
 *
 * Also, command line strings support breaking the same command in multiple lines by using `\` and adding bash-shell like commands in lines that starts with `#`, like in:
 *
 * ```js
 * const result = await execute(`
 *   convert -size 250x100 xc: +noise Random -channel R -threshold .4% \\
 *     -negate -channel RG -separate +channel \\
 *     # heads up! this is a comment because the line started with #
 *     \( +clone \) -compose multiply -flatten \\
 *     -virtual-pixel Tile -background Black \\
 *     -blur 0x.6 -motion-blur 0x15-90 -normalize \\
 *     +distort Polar 0 +repage 'star inward.gif'
 * `)
 * ```
 *
 * If you need to escape arguments like file names with spaces, use single quotes `'`, like the output file in the previous example `'star inward.gif'`
 */
export type ExecuteCommand = Command[] | Command | string

export interface ExecuteResultOne extends CallResult {
  errors: any[]
  exitCode: number
}

/**
 * Execute first command in given config.
 *
 * @see [execute](https://github.com/KnicKnic/WASM-ImageMagick/tree/master/apidocs#execute) for full documentation on accepted signatures
 */
export async function executeOne(configOrCommand: ExecuteConfig | ExecuteCommand | MagickInputFile[], execCommand?: ExecuteCommand): Promise<ExecuteResultOne> {
  const config = asExecuteConfig(configOrCommand, execCommand)

  config.inputFiles = config.inputFiles || []
  const command = asCommand(config.commands)[0]
  let result: CallResult = {
    stderr: [],
    stdout: [],
    outputFiles: [],
    exitCode: 1,
    command: command.map(c=>c+''), 
    inputFiles: config.inputFiles
  }
  try {
    result = await call(config.inputFiles, command.map(c => c + ''))
    if (result.exitCode) {
      return { ...result, errors: ['exit code: ' + result.exitCode + ' stderr: ' + result.stderr.join('\n')] }
    }
    return { ...result, errors: [undefined] }

  } catch (error) {
    return { ...result, errors: [error + ', exit code: ' + result.exitCode + ', stderr: ' + result.stderr.join('\n')] }
  }
}

export function isExecuteConfig(arg: any): arg is ExecuteConfig {
  return !!arg.commands
}

/**
 * Transform  `configOrCommand: ExecuteConfig | ExecuteCommand` to a valid ExecuteConfig object
 */
export function asExecuteConfig(configOrCommandOrFiles: ExecuteConfig | ExecuteCommand | MagickInputFile[], command?: ExecuteCommand): ExecuteConfig {
  if (isExecuteConfig(configOrCommandOrFiles)) {
    return configOrCommandOrFiles
  }
  else {
    if (Array.isArray(configOrCommandOrFiles) && isInputFile(configOrCommandOrFiles[0])) {
      if (!command) {
        throw new Error('No command given')
      }
      return {
        inputFiles: configOrCommandOrFiles as MagickInputFile[],
        commands: command,
      }
    }
  }
  return {
    inputFiles: [],
    commands: configOrCommandOrFiles as ExecuteCommand,
  }
}

/**
 * `execute()` shortcut that return directly the first output file or undefined if none or error occur
 */
export async function executeAndReturnOutputFile(configOrCommand: ExecuteConfig | ExecuteCommand | MagickInputFile[],
  command?: ExecuteCommand): Promise<MagickOutputFile | undefined> {
  const config = asExecuteConfig(configOrCommand, command)
  const result = await execute(config)
  return result.outputFiles.length && result.outputFiles[0] || undefined
}


export interface ExecuteResult extends ExecuteResultOne {
  results: ExecuteResultOne[],
  /** the original commands used in the execute() call */
  commands: ExecuteCommand[],
  // breakOnError?: boolean
}

/**
 * Execute all commands in given config serially in order. Output files from a command become available as
 * input files in next commands. In the following example we execute two commands. Notice how the second one uses `image2.png` which was the output file of the first one:
 *
 * ```ts
 * const { outputFiles, exitCode, stderr} = await execute({
 *   inputFiles: [await buildInputFile('fn.png', 'image1.png')],
 *   commands: `
 *     convert image1.png -bordercolor #ffee44 -background #eeff55 +polaroid image2.png
 *     convert image2.png -fill #997711 -tint 55 image3.jpg
 * `
 * })
 * if (exitCode) {
 *   alert(`There was an error with the command: ${stderr.join('\n')}`)
 * }
 * else {
 *   await loadImageElement(outputFiles.find(f => f.name==='image3.jpg'), document.getElementById('outputImage'))
 * }
 * ```
 * Another varlid signature is passing input files and commands as parameters:
 *
 * ```ts
 * const { outputFiles, exitCode, stderr} = await execute([await buildInputFile('foo.png'], 'convert foo.png foo.jpg')
 * ```
 *
 * Another valid signature is just providing the command when there there is no need for input files:
 *
 * ```ts
 * const { outputFiles, exitCode, stderr} = await execute('identify rose:')
 * ```
 *
 * See {@link ExecuteCommand} for different command syntax supported.
 *
 * See {@link ExecuteResult} for details on the object returned
 */

export async function execute(configOrCommandOrFiles: ExecuteConfig | ExecuteCommand | MagickInputFile[], command?: ExecuteCommand): Promise<ExecuteResult> {

  const config = asExecuteConfig(configOrCommandOrFiles, command)
  config.inputFiles = config.inputFiles || []
  const allOutputFiles: { [name: string]: MagickOutputFile } = {}
  const allInputFiles: { [name: string]: MagickInputFile } = {}
  // const allCommands = []
  config.inputFiles.forEach(f => {
    allInputFiles[f.name] = f
  })
  let allErrors = []
  const results: ExecuteResultOne[] = []
  let allStdout = []
  let allStderr = []
  async function mapper(c: Command) {
    const thisConfig = {
      inputFiles: values(allInputFiles),
      commands: [c],
    }
    const result = await executeOne(thisConfig)
    // allCommands.push(result.command)
    results.push(result)
    allErrors = allErrors.concat(result.errors || [])
    allStdout = allStdout.concat(result.stdout || [])
    allStderr = allStderr.concat(result.stderr || [])
    await pMap(result.outputFiles, async f => {
      allOutputFiles[f.name] = f
      const inputFile = await asInputFile(f)
      allInputFiles[inputFile.name] = inputFile
    })
  }
  const commands = asCommand(config.commands)
  await pMap(commands, mapper, { concurrency: 1 })
  const resultWithError = results.find(r => r.exitCode !== 0)
  return {
    outputFiles: values(allOutputFiles),
    errors: allErrors,
    results,
    stdout: allStdout,
    stderr: allStderr,
    exitCode: resultWithError ? resultWithError.exitCode : 0,
    command: [],
    commands, 
    inputFiles:  config.inputFiles
  }
}
