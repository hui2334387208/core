import { MockInjector } from '../../../../tools/dev-tool/src/mock-injector';
import { createBrowserInjector } from '../../../../tools/dev-tool/src/injector-helper';
import { URI, Disposable, IContextKeyService, StorageProvider, ILogger } from '@ali/ide-core-browser';
import { LabelService } from '@ali/ide-core-browser/lib/services';
import { Directory, File } from '../../src/common/file-tree-node.define';
import { TreeNodeType } from '@ali/ide-components';
import { FileTreeModelService } from '@ali/ide-file-tree-next/lib/browser/services/file-tree-model.service';
import * as styles from '../../src/browser/file-tree-node.modules.less';
import { IFileTreeService } from '@ali/ide-file-tree-next';
import { IFileTreeAPI } from '@ali/ide-file-tree-next';
import { IDialogService, IMessageService } from '@ali/ide-overlay';
import { WorkbenchEditorService } from '@ali/ide-editor';
import { MockContextKeyService } from '@ali/ide-monaco/lib/browser/mocks/monaco.context-key.service';
import { IThemeService } from '@ali/ide-theme';
import { IDecorationsService } from '@ali/ide-decoration';
import { Emitter } from '@reexport/vsc-modules/lib/base/common/event';
import { FileContextKey } from '@ali/ide-file-tree/lib/browser/file-contextkey';
import { ICtxMenuRenderer } from '@ali/ide-core-browser/lib/menu/next';
import { createMockedMonaco } from '@ali/ide-monaco/lib/__mocks__/monaco';

class TempDirectory {}

describe('FileTreeModelService should be work', () => {
  (global as any).monaco = createMockedMonaco() as any;
  let injector: MockInjector;
  let fileTreeModelService: FileTreeModelService;
  const rootUri = URI.file('/userhome');
  const mockWatcher = {
    callback: jest.fn(),
  };
  const mockRoot = {
    watcher: {
      on: jest.fn(() => Disposable.create(() => { })),
      notifyDidChangeMetadata: jest.fn(),
    },
    watchEvents: {
      get: jest.fn(() => mockWatcher),
    },
    path: 'testRoot',
    uri: rootUri,
  } as any;
  const mockCtxMenuRenderer = {
    show: jest.fn(),
  } as any;
  const newDirectoryByName = (name) => {
    const directory = {
      uri: rootUri.resolve(name),
      name,
      filestat: {
        uri: rootUri.resolve(name).toString(),
        isDirectory: true,
        lastModification: new Date().getTime(),
      },
      type: TreeNodeType.CompositeTreeNode,
    } as Directory;
    directory.constructor = new TempDirectory().constructor;
    return directory;
  };
  const mockDecorationsService = {
    onDidChangeDecorations: jest.fn(() => Disposable.create(() => {})),
  };
  const mockThemeService = {
    onThemeChange: jest.fn(() => Disposable.create(() => {})),
  };
  const mockExploreStorage = {
    get: jest.fn(() => {
      return {
        specVersion: 1,
        scrollPosition: 100,
        expandedDirectories: {
          atSurface: [],
          buried: [],
        },
      };
    }),
    set: jest.fn(),
  };
  const mockLabelService = {
    onDidChange: jest.fn(() => Disposable.create(() => {})),
  };
  const mockFileTreeService = {
    onNodeRefreshed: jest.fn(() => Disposable.create(() => {})),
    onWorkspaceChange: jest.fn(() => Disposable.create(() => {})),
    requestFlushEventSignalEvent: jest.fn(() => Disposable.create(() => {})),
    resolveChildren: jest.fn(() => {
      return [mockRoot];
    }),
    startWatchFileEvent: jest.fn(),
    refresh: jest.fn(),
    contextMenuContextKeyService: new MockContextKeyService().createScoped({} as any),
  };
  beforeEach(async (done) => {
    injector = createBrowserInjector([]);

    injector.overrideProviders(
      {
        token: LabelService,
        useValue: mockLabelService,
      },
      {
        token: FileContextKey,
        useClass: FileContextKey,
      },
      {
        token: ICtxMenuRenderer,
        useValue: mockCtxMenuRenderer,
      },
      {
        token: ILogger,
        useValue: console,
      },
      {
        token: IFileTreeService,
        useValue: mockFileTreeService,
      },
      {
        token: StorageProvider,
        useValue: () => mockExploreStorage,
      },
      {
        token: IDecorationsService,
        useValue: mockDecorationsService,
      },
      {
        token: IThemeService,
        useValue: mockThemeService,
      },
      {
        token: IFileTreeAPI,
        useValue: {},
      },
      {
        token: IDialogService,
        useValue: {},
      },
      {
        token: IMessageService,
        useValue: {},
      },
      {
        token: WorkbenchEditorService,
        useValue: {},
      },
      {
        token: IContextKeyService,
        useClass: MockContextKeyService,
      },
    );
    const root = {
      ...newDirectoryByName('child'),
      ensureLoaded: jest.fn(),
      watcher: {
        on: () => Disposable.create(() => {}),
      },
      getTreeNodeAtIndex: () => {
        return root;
      },
    };

    fileTreeModelService = injector.get(FileTreeModelService);
    await fileTreeModelService.whenReady;
    done();
  });

  afterEach(() => {
    injector.disposeAll();
  });

  it('should init success', () => {
    expect(mockLabelService.onDidChange).toBeCalledTimes(1);
    expect(mockFileTreeService.onNodeRefreshed).toBeCalledTimes(1);
    expect(mockFileTreeService.onWorkspaceChange).toBeCalledTimes(1);
    expect(mockFileTreeService.requestFlushEventSignalEvent).toBeCalledTimes(1);
    expect(mockFileTreeService.startWatchFileEvent).toBeCalledTimes(1);
    expect(mockThemeService.onThemeChange).toBeCalledTimes(1);
    expect(mockDecorationsService.onDidChangeDecorations).toBeCalledTimes(1);
    expect(fileTreeModelService.onDidFocusedFileChange).toBeDefined();
    expect(fileTreeModelService.onDidSelectedFileChange).toBeDefined();
    expect(fileTreeModelService.treeModel).toBeDefined();
  });

  it('activeFileDecoration method should be work', () => {
    const mockFileTreeService = {
      on: jest.fn(),
    } as any;
    fileTreeModelService.initDecorations(mockRoot);
    const node = new File(mockFileTreeService, mockRoot, mockRoot.uri.resolve('test.js'), 'test.js', undefined, 'tooltip');
    fileTreeModelService.activeFileDecoration(node);
    const decoration = fileTreeModelService.decorations.getDecorations(node);
    expect(decoration).toBeDefined();
    expect(decoration!.classlist).toEqual([styles.mod_selected, styles.mod_focused]);
  });

  it('selectFileDecoration method should be work', () => {
    const mockFileTreeService = {
      on: jest.fn(),
    } as any;
    fileTreeModelService.initDecorations(mockRoot);
    const node = new File(mockFileTreeService, mockRoot, mockRoot.uri.resolve('test.js'), 'test.js', undefined, 'tooltip');
    fileTreeModelService.selectFileDecoration(node);
    const decoration = fileTreeModelService.decorations.getDecorations(node);
    expect(decoration).toBeDefined();
    expect(decoration!.classlist).toEqual([styles.mod_selected]);
  });

  it('enactiveFileDecoration method should be work', () => {
    const mockFileTreeService = {
      on: jest.fn(),
    } as any;
    fileTreeModelService.initDecorations(mockRoot);
    const node = new File(mockFileTreeService, mockRoot, mockRoot.uri.resolve('test.js'), 'test.js', undefined, 'tooltip');
    fileTreeModelService.activeFileDecoration(node);
    let decoration = fileTreeModelService.decorations.getDecorations(node);
    expect(decoration).toBeDefined();
    expect(decoration!.classlist).toEqual([styles.mod_selected, styles.mod_focused]);
    fileTreeModelService.enactiveFileDecoration();
    decoration = fileTreeModelService.decorations.getDecorations(node);
    expect(decoration).toBeDefined();
    expect(decoration!.classlist).toEqual([styles.mod_selected]);
  });

  it('removeFileDecoration method should be work', () => {
    const mockFileTreeService = {
      on: jest.fn(),
    } as any;
    fileTreeModelService.initDecorations(mockRoot);
    const node = new File(mockFileTreeService, mockRoot, mockRoot.uri.resolve('test.js'), 'test.js', undefined, 'tooltip');
    fileTreeModelService.activeFileDecoration(node);
    let decoration = fileTreeModelService.decorations.getDecorations(node);
    fileTreeModelService.removeFileDecoration();
    decoration = fileTreeModelService.decorations.getDecorations(node);
    expect(decoration).toBeDefined();
    expect(decoration!.classlist).toEqual([]);
  });

  it('handleTreeHandler method should be work', () => {
    const errorEmitter = new Emitter();
    const treeHandle = { ensureVisible: () => { }, onError: errorEmitter.event } as any;
    fileTreeModelService.handleTreeHandler(treeHandle);
    expect(fileTreeModelService.fileTreeHandle).toEqual(treeHandle);
    mockFileTreeService.refresh.mockClear();
    errorEmitter.fire('');
    expect(mockFileTreeService.refresh).toBeCalledTimes(1);
  });

  it('handleTreeBlur method should be work', () => {
    const mockFileTreeService = {
      on: jest.fn(),
    } as any;
    fileTreeModelService.initDecorations(mockRoot);
    const node = new File(mockFileTreeService, mockRoot, mockRoot.uri.resolve('test.js'), 'test.js', undefined, 'tooltip');
    fileTreeModelService.initDecorations(mockRoot);
    fileTreeModelService.activeFileDecoration(node);
    let decoration = fileTreeModelService.decorations.getDecorations(node);
    expect(decoration).toBeDefined();
    expect(decoration!.classlist).toEqual([styles.mod_selected, styles.mod_focused]);
    fileTreeModelService.handleTreeBlur();
    decoration = fileTreeModelService.decorations.getDecorations(node);
    expect(decoration).toBeDefined();
    expect(decoration!.classlist).toEqual([styles.mod_selected]);
  });

  it('canHandleRefreshEvent method should be work', async (done) => {
    await fileTreeModelService.canHandleRefreshEvent();
    done();
  });

  it('clearFileSelectedDecoration method should be work', () => {
    const mockFileTreeService = {
      on: jest.fn(),
    } as any;
    fileTreeModelService.initDecorations(mockRoot);
    const node = new File(mockFileTreeService, mockRoot, mockRoot.uri.resolve('test.js'), 'test.js', undefined, 'tooltip');
    fileTreeModelService.selectFileDecoration(node);
    const decoration = fileTreeModelService.decorations.getDecorations(node);
    expect(decoration).toBeDefined();
    expect(decoration!.classlist).toEqual([styles.mod_selected]);
    fileTreeModelService.clearFileSelectedDecoration();
    expect(decoration!.classlist).toEqual([]);
  });

  it('toggleDirectory method should be work', async (done) => {
    const errorEmitter = new Emitter();
    const treeHandle = { collapseNode: jest.fn(), expandNode: jest.fn(), onError: errorEmitter.event } as any;
    let mockNode = { expanded: false };
    fileTreeModelService.handleTreeHandler(treeHandle);
    await fileTreeModelService.toggleDirectory(mockNode as any);
    expect(treeHandle.expandNode).toBeCalledTimes(1);
    mockNode = { expanded: true };
    await fileTreeModelService.toggleDirectory(mockNode as any);
    expect(treeHandle.collapseNode).toBeCalledTimes(1);
    done();
  });

  it('handleContextMenu method should be work', () => {
    const mockNode: Directory = newDirectoryByName('testDirectory');
    const mockEvent = {
      stopPropagation: jest.fn(),
      preventDefault: jest.fn(),
      nativeEvent: {
        x: 1,
        y: 1,
      },
    } as any;
    fileTreeModelService.handleContextMenu(mockEvent, mockNode);
    expect(mockCtxMenuRenderer.show).toBeCalledTimes(1);
    expect(mockEvent.stopPropagation).toBeCalledTimes(1);
    expect(mockEvent.preventDefault).toBeCalledTimes(1);
  });
});