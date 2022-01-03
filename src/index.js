function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.map((child) =>
        typeof child === "object" ? child : createTextElement(child)
      ),
    },
  };
}

function createTextElement(text) {
  return {
    type: "TEXT_ELEMENT",
    props: {
      nodeValue: text,
      children: [],
    },
  };
}

function createDom(fiber) {
  const dom =
    fiber.type === "TEXT_ELEMENT"
      ? document.createTextNode("")
      : document.createElement(fiber.type);

  updateDom(dom, {}, fiber.props);

  return dom;
}

const isEvent = (key) => key.startsWith("on"); // 判断是不是事件属性
const isProperty = (key) => key !== "children" && !isEvent(key); // 判断是不是子dom | 子组件 | 事件
const isNew = (prev, next) => (key) => prev[key] !== next[key]; // 判断有没新属性
const isGone = (prev, next) => (key) => !(key in next); // 判断属性是否存在

/**
 * 更新dom属性, 比较新的props和 旧的props
 * @param {*} dom
 * @param {*} prevProps
 * @param {*} nextProps
 */
function updateDom(dom, prevProps, nextProps) {
  //Remove old or changed event listeners
  // 移除旧的事件监听
  Object.keys(prevProps)
    .filter(isEvent)
    .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      dom.removeEventListener(eventType, prevProps[name]);
    });

  // 移除旧属性
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach((name) => {
      dom[name] = "";
    });

  // 设置新属性
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      dom[name] = nextProps[name];
    });

  // 监听事件
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      dom.addEventListener(eventType, nextProps[name]);
    });
}

// 渲染根fiber dom
function commitRoot() {
  deletions.forEach(commitWork);
  commitWork(wipRoot.child);
  currentRoot = wipRoot;
  wipRoot = null;
}

/**
 * 生成fiber dom
 * @param {*} fiber
 */
function commitWork(fiber) {
  if (!fiber) {
    return;
  }

  // 获取父fiber dom
  let domParentFiber = fiber.parent;
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent;
  }

  const domParent = domParentFiber.dom;

  // 根据fiber的标签进行对应的操作
  if (fiber.effectTag === "PLACEMENT" && fiber.dom != null) {
    domParent.appendChild(fiber.dom); // 从父fiber dom 中插入当前fiber dom...
  } else if (fiber.effectTag === "UPDATE" && fiber.dom != null) {
    updateDom(fiber.dom, fiber.alternate.props, fiber.props);
  } else if (fiber.effectTag === "DELETION") {
    //
    commitDeletion(fiber, domParent);
  }

  commitWork(fiber.child); // 递归插入子dom...
  commitWork(fiber.sibling); // 递归插入兄弟dom...
}

/**
 * 如果当前fiber dom中没有dom, 则递归删除对应的fiber,
 * @param {*} fiber
 * @param {*} domParent
 */
function commitDeletion(fiber, domParent) {
  if (fiber.dom) {
    domParent.removeChild(fiber.dom);
  } else {
    commitDeletion(fiber.child, domParent);
  }
}

/**
 * 将Fiber树,渲染到指定dom
 * @param {*} element
 * @param {*} container
 */
function render(element, container) {
  // 设置根Fiber
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot, // fiber dom 中旧的fiber, 当fiber树更新时, 会将新的fiber与旧的fiber做对比
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
}

let nextUnitOfWork = null; // 下一个Fiber dom
let currentRoot = null; // 整个Fiber树的最后一个Fiber dom
let wipRoot = null; // 根Fiber dom
let deletions = null; // 需要删除的dom|组件

/**
 * 渲染fiber树时, 把渲染交给requestIdleCallback去执行
 * requestIdleCallback是在 浏览器重排/重绘 后如果当前帧还有空余时间时被调用的
 * requestIdleCallback: https://www.jianshu.com/p/2771cb695c81?tt_from=weixin
 * 比较新版本的react 没用requestIdleCallback, 而是通过宏任务, 模拟requestIdleCallback实现时间切片
 * @param {*} deadline
 */
function workLoop(deadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }

  requestIdleCallback(workLoop);
}

requestIdleCallback(workLoop);

/**
 * 插入组件|元素到dom中、 创建fiber、 选中下一个需要插入fiber的组件|元素
 * @param {*} fiber
 */
function performUnitOfWork(fiber) {
  const isFunctionComponent = fiber.type instanceof Function;
  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }
  if (fiber.child) {
    return fiber.child;
  }
  let nextFiber = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    nextFiber = nextFiber.parent;
  }
}

let wipFiber = null;
let hookIndex = null;

// 创建函数组件
function updateFunctionComponent(fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  wipFiber.hooks = []; // 创建函数组件的时候, 会给组件添加hooks队列

  const children = [fiber.type(fiber.props)]; // 这里的fiber.type 就是函数组件执行的函数, 执行函数, 函数组件把组件dom 返回过来
  // 然后给函数组件生成fiber
  reconcileChildren(fiber, children);
}

function useState(initial) {
  // 旧hook
  const oldHook =
    wipFiber.alternate &&
    wipFiber.alternate.hooks &&
    wipFiber.alternate.hooks[hookIndex];

  // 如果有旧的hook state, 则用旧的hook state 否则用初始值
  const hook = {
    state: oldHook ? oldHook.state : initial,
    queue: [], // hook队列
  };

  const actions = oldHook ? oldHook.queue : []; // 动作队列
  actions.forEach((action) => {
    // 返回最终state
    hook.state = action instanceof Function ? action(hook.state) : action;
  });

  const setState = (action) => {
    hook.queue.push(action); // 把每次更改hook state的动作, 插入到当前hook的队列中
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
    };
    nextUnitOfWork = wipRoot;
    deletions = [];
  };

  wipFiber.hooks.push(hook);
  hookIndex++;
  return [hook.state, setState];
}

/**
 * 创建dom
 * @param {*} fiber
 */
function updateHostComponent(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  reconcileChildren(fiber, fiber.props.children);
}

/**
 * 生成fiber
 * @param {*} wipFiber
 * @param {*} elements
 */
function reconcileChildren(wipFiber, elements) {
  let index = 0;
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;
  let prevSibling = null;

  while (index < elements.length || oldFiber != null) {
    const element = elements[index];
    let newFiber = null;

    const sameType = oldFiber && element && element.type === oldFiber.type;

    if (sameType) {
      newFiber = {
        type: oldFiber.type,
        props: element.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: "UPDATE",
      };
    }
    if (element && !sameType) {
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: "PLACEMENT",
      };
    }
    if (oldFiber && !sameType) {
      oldFiber.effectTag = "DELETION";
      deletions.push(oldFiber);
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling;
    }

    if (index === 0) {
      wipFiber.child = newFiber; // 把新fiber 赋值给
    } else if (element) {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    index++;
  }
}

const Didact = {
  createElement,
  render,
  useState,
};

/** @jsx Didact.createElement */
function Color() {
  const [color, setColor] = Didact.useState("rgb(0,0,0)");

  function getColor() {
    return `rgb(${~~(Math.random() * 255)},${~~(Math.random() * 255)},${~~(
      Math.random() * 255
    )})`;
  }

  return (
    <div
      onClick={() => setColor(getColor())}
      style={`width:100px;height:100px;background-color:${color}`}
    ></div>
  );
}

function Counter() {
  const [state, setState] = Didact.useState(1);
  return (
    <div>
      <h1 onClick={() => setState((c) => c + 1)} style="user-select: none">
        Count: {state}
      </h1>
      <Color />
    </div>
  );
}

const element = <Counter />;

const container = document.getElementById("root");
Didact.render(element, container);
