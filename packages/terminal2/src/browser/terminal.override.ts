import { Injectable, Autowired } from '@ali/common-di';
import { Emitter, ILogger, isUndefined } from '@ali/ide-core-common';
import { IExternlTerminalService, ITerminalServicePath, ITerminalServiceClient, TerminalOptions, ITerminalClient, Terminal } from '../common';
import { TerminalImpl } from './terminal';

@Injectable()
export class MockTerminalService implements IExternlTerminalService {
  @Autowired(ILogger)
  logger: ILogger;

  @Autowired(ITerminalServicePath)
  private terminalService: ITerminalServiceClient;

  @Autowired(ITerminalClient)
  private terminalClient: ITerminalClient;

  private eventMap: Map<string, Emitter<any>> = new Map();
  private terminals: Map<string, Terminal> = new Map();

  private createMockSocket(id: string) {
    const self = this;
    return {
      addEventListener: (type: string, handler: (e: any) => void) => {
        this.logger.debug('terminal2 type', type);
        const emitter = new Emitter<any>();
        emitter.event(handler);
        self.eventMap.set(id + type, emitter);
      },
      send: (message: string) => {
        self.send(id, message);
      },
      readyState: 1,
    };
  }

  async create(id: string, terminal: Terminal, rows: number, cols: number, options: TerminalOptions) {
    const socket = this.createMockSocket(id);
    (this.terminalService.create(id, rows, cols, options) as Promise<{
      pid: number,
      name: string,
    }>)
    .then((info) => {
      if (!info) {
        return;
      }
      if (!terminal.name) {
        terminal.setName(info.name);
      }
      terminal.setProcessId(info.pid);
    });

    // @ts-ignore
    terminal.xterm.attach(socket);
    this.terminals.set(id, terminal);

    return true;
  }

  resize(id: string, rows: number, cols: number) {
    this.terminalService.resize(id, rows, cols);
  }

  getProcessId(id: string): Promise<number> {
    // 从 node 端过来的应该会被转化为一个 promise 的远程调用
    // @ts-ignore
    return this.terminalService.getProcessId(id);
  }

  disposeById(id: string) {
    this.terminalService.disposeById(id);
  }

  /**
   * 这个方法是给后端调用的。
   *
   * @param id
   * @param message
   */
  onMessage(id: string, message: string) {
    const terminal = this.terminalClient.getTerminal(id);

    if (this.eventMap.has(id + 'message')) {
      this.eventMap.get(id + 'message')!.fire({
        data: message,
      });
    } else {
      this.logger.debug('message event not found');
    }

    if (terminal &&
      terminal.serviceInitPromise) {
      setTimeout(() => {
        terminal.finishServiceInitPromise();
      }, 200);
    }
  }

  private send(id: string, message: string) {
    this.terminalService.onMessage(id, message);
  }

  sendText(id: string, text: string, addNewLine?: boolean) {
    const terminal = this.terminals.get(id);

    if (!terminal) {
      throw new Error('Not find terminal');
    }

    if (isUndefined(addNewLine)) {
      addNewLine = true;
    }

    if (terminal.serviceInitPromise) {
      terminal.serviceInitPromise.then(() => {
       this.send(id, text + (addNewLine ? `\r` : ''));
      });
    } else {
      this.send(id, text + (addNewLine ? `\r` : ''));
    }
  }
}
