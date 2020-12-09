import { Event, Emitter, Disposable, URI, AsyncEmitter, WaitUntilEvent, CancellationToken, ILogger, getDebugLogger } from '@ali/ide-core-common';
import * as vscode from 'vscode';
import { ExtensionDocumentDataManager, IMainThreadWorkspace, MainThreadAPIIdentifier, WorkspaceEditDto } from '../../../common/vscode';
import { WorkspaceEdit } from '../../../common/vscode/ext-types';
import { FileSystemEvents, IExtHostFileSystemEvent, SourceTargetPair } from '../../../common/vscode/file-system';
import { IRelativePattern, parse } from '../../../common/vscode/glob';
import { TypeConverts } from '../../../common/vscode/converter';
import { IRPCProtocol } from '@ali/ide-connection';
import { IExtension } from '../../..';
import { FileOperation } from '@ali/ide-workspace-edit';

class FileSystemWatcher implements vscode.FileSystemWatcher {

  private readonly _onDidCreate = new Emitter<vscode.Uri>();
  private readonly _onDidChange = new Emitter<vscode.Uri>();
  private readonly _onDidDelete = new Emitter<vscode.Uri>();
  private _disposable: Disposable;
  private _config: number;

  get ignoreCreateEvents(): boolean {
    return Boolean(this._config & 0b001);
  }

  get ignoreChangeEvents(): boolean {
    return Boolean(this._config & 0b010);
  }

  get ignoreDeleteEvents(): boolean {
    return Boolean(this._config & 0b100);
  }

  constructor(dispatcher: Event<FileSystemEvents>, globPattern: string | IRelativePattern, ignoreCreateEvents?: boolean, ignoreChangeEvents?: boolean, ignoreDeleteEvents?: boolean) {

    this._config = 0;
    if (ignoreCreateEvents) {
      this._config += 0b001;
    }
    if (ignoreChangeEvents) {
      this._config += 0b010;
    }
    if (ignoreDeleteEvents) {
      this._config += 0b100;
    }

    const parsedPattern = parse(globPattern);

    const subscription = dispatcher((events) => {
      if (!ignoreCreateEvents) {
        for (const created of events.created) {
          const uri = URI.revive(created);
          if (parsedPattern(uri.fsPath)) {
            this._onDidCreate.fire(uri);
          }
        }
      }
      if (!ignoreChangeEvents) {
        for (const changed of events.changed) {
          const uri = URI.revive(changed);
          if (parsedPattern(uri.fsPath)) {
            this._onDidChange.fire(uri);
          }
        }
      }
      if (!ignoreDeleteEvents) {
        for (const deleted of events.deleted) {
          const uri = URI.revive(deleted);
          if (parsedPattern(uri.fsPath)) {
            this._onDidDelete.fire(uri);
          }
        }
      }
    });

    this._disposable = new Disposable(this._onDidCreate, this._onDidChange, this._onDidDelete, subscription);
  }

  dispose() {
    this._disposable.dispose();
  }

  get onDidCreate(): Event<vscode.Uri> {
    return this._onDidCreate.event;
  }

  get onDidChange(): Event<vscode.Uri> {
    return this._onDidChange.event;
  }

  get onDidDelete(): Event<vscode.Uri> {
    return this._onDidDelete.event;
  }
}

interface IExtensionListener<E> {
  extension: IExtension;
  (e: E): any;
}

export class ExtHostFileSystemEvent implements IExtHostFileSystemEvent {

  private readonly _onFileSystemEvent = new Emitter<FileSystemEvents>();

  private readonly _onDidRenameFile = new Emitter<vscode.FileRenameEvent>();
  private readonly _onDidCreateFile = new Emitter<vscode.FileCreateEvent>();
  private readonly _onDidDeleteFile = new Emitter<vscode.FileDeleteEvent>();
  private readonly _onWillRenameFile = new AsyncEmitter<vscode.FileWillRenameEvent>();
  private readonly _onWillCreateFile = new AsyncEmitter<vscode.FileWillCreateEvent>();
  private readonly _onWillDeleteFile = new AsyncEmitter<vscode.FileWillDeleteEvent>();

  readonly onDidRenameFile: Event<vscode.FileRenameEvent> = this._onDidRenameFile.event;
  readonly onDidCreateFile: Event<vscode.FileCreateEvent> = this._onDidCreateFile.event;
  readonly onDidDeleteFile: Event<vscode.FileDeleteEvent> = this._onDidDeleteFile.event;

  protected readonly logger: ILogger = getDebugLogger();

  private readonly _proxy: IMainThreadWorkspace;

  constructor(private readonly rpcProtocol: IRPCProtocol, private _extHostDocumentsAndEditors: ExtensionDocumentDataManager) {
    this._proxy = this.rpcProtocol.getProxy(MainThreadAPIIdentifier.MainThreadWorkspace);
  }

  // --- file events

  createFileSystemWatcher(globPattern: string | IRelativePattern, ignoreCreateEvents?: boolean, ignoreChangeEvents?: boolean, ignoreDeleteEvents?: boolean): vscode.FileSystemWatcher {
    return new FileSystemWatcher(this._onFileSystemEvent.event, globPattern, ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents);
  }

  $onFileEvent(events: FileSystemEvents) {
    this._onFileSystemEvent.fire(events);
  }

  // --- file operations

  $onDidRunFileOperation(operation: FileOperation, files: SourceTargetPair[]): void {
    switch (operation) {
      case FileOperation.MOVE:
        this._onDidRenameFile.fire(Object.freeze({ files: files.map((f) => ({ oldUri: URI.revive(f.source!), newUri: URI.revive(f.target) })) }));
        break;
      case FileOperation.DELETE:
        this._onDidDeleteFile.fire(Object.freeze({ files: files.map((f) => URI.revive(f.target)) }));
        break;
      case FileOperation.CREATE:
        this._onDidCreateFile.fire(Object.freeze({ files: files.map((f) => URI.revive(f.target)) }));
        break;
      default:
      // ignore, dont send
    }
  }

  getOnWillRenameFileEvent(extension: IExtension): Event<vscode.FileWillRenameEvent> {
    return this._createWillExecuteEvent(extension, this._onWillRenameFile);
  }

  getOnWillCreateFileEvent(extension: IExtension): Event<vscode.FileWillCreateEvent> {
    return this._createWillExecuteEvent(extension, this._onWillCreateFile);
  }

  getOnWillDeleteFileEvent(extension: IExtension): Event<vscode.FileWillDeleteEvent> {
    return this._createWillExecuteEvent(extension, this._onWillDeleteFile);
  }

  private _createWillExecuteEvent<E extends WaitUntilEvent>(extension: IExtension, emitter: AsyncEmitter<E>): Event<E> {
    return (listener, thisArg, disposables) => {
      const wrappedListener: IExtensionListener<E> = function wrapped(e: E) { listener.call(thisArg, e); };
      wrappedListener.extension = extension;
      return emitter.event(wrappedListener, undefined, disposables);
    };
  }

  async $onWillRunFileOperation(operation: FileOperation, files: SourceTargetPair[], timeout: number, token: CancellationToken): Promise<any> {
    switch (operation) {
      case FileOperation.MOVE:
        await this._fireWillEvent(this._onWillRenameFile, { files: files.map((f) => ({ oldUri: URI.revive(f.source!), newUri: URI.revive(f.target) })) }, timeout, token);
        break;
      case FileOperation.DELETE:
        await this._fireWillEvent(this._onWillDeleteFile, { files: files.map((f) => URI.revive(f.target)) }, timeout, token);
        break;
      case FileOperation.CREATE:
        await this._fireWillEvent(this._onWillCreateFile, { files: files.map((f) => URI.revive(f.target)) }, timeout, token);
        break;
      default:
      // ignore, dont send
    }
  }

  private async _fireWillEvent<E extends WaitUntilEvent>(emitter: AsyncEmitter<E>, data: Omit<E, 'waitUntil'>, timeout: number, token: CancellationToken): Promise<any> {

    const edits: WorkspaceEdit[] = [];

    await emitter.fireAsync(data, token, async (thenable, listener) => {
      // ignore all results except for WorkspaceEdits. Those are stored in an array.
      const now = Date.now();
      const result = await Promise.resolve(thenable);
      if (result instanceof WorkspaceEdit) {
        edits.push(result);
      }

      if (Date.now() - now > timeout) {
        this.logger.log('SLOW file-participant', ( listener as IExtensionListener<E>).extension?.id);
      }
    });

    if (token.isCancellationRequested) {
      return;
    }

    if (edits.length > 0) {
      // concat all WorkspaceEdits collected via waitUntil-call and apply them in one go.
      const dto: WorkspaceEditDto = { edits: [] };
      for (const edit of edits) {
        const { edits } = TypeConverts.WorkspaceEdit.from(edit, this._extHostDocumentsAndEditors);
        dto.edits = dto.edits.concat(edits);
      }
      return this._proxy.$tryApplyWorkspaceEdit(dto);
    }
  }

}
