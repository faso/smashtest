const clonedeep = require('lodash/clonedeep');
const utils = require('./utils.js');
const Constants = require('./constants.js');

/**
 * Represents a Step within a Tree or StepBlock
 */
class Step {
    constructor() {
        this.indents = -1;                    // number of indents before this step's text, where an indent consists of SPACES_PER_INDENT spaces

        this.parent = null;                   // Step or StepBlock that's the parent of this Step (null if this Step is itself part of a StepBlock)
        this.children = [];                   // Step or StepBlock objects that are children of this Step ([] if this Step is itself part of a StepBlock)

        this.filename = null;                 // filename where this step is from
        this.lineNumber = null;               // line number where this step is from

        /*
        OPTIONAL

        this.line = "";                       // entire text of the step, including spaces at the front, comments, etc.
        this.text = "";                       // text of the command of the step (not including spaces in front, identifiers, comments, etc.)
        this.identifiers = [];                // Array of String, each of which represents an identifier (e.g., ['..', '+', '#something']) in front or behind the step
        this.frontIdentifiers = [];           // Array of String, identifiers in front of the step text
        this.backIdentifiers = [];            // Array of String, identifiers in back of the step text
        this.codeBlock = "";                  // if this is a code block step, contains the '{' followed by the code
        this.comment = "";                    // text of the comment at the end of the line (e.g., '// comment here')

        this.isFunctionDeclaration = false;   // true if this step is a function declaration
        this.isFunctionCall = false;          // true if this step is a function call
        this.isPrivateFunctionDeclaration = false;   // true if this is a private function declaration
        this.isTextualStep = false;           // true if this step is textual (-) and not a function call
        this.functionDeclarationInTree = {};  // Step that corresponds to the function declaration, if this step is a function call
        this.functionDeclarationText = "";    // if this step is a function call, this is set to the corresponding function declaration's text

        this.isToDo = false;                  // true if this step has the To Do identifier (-T)
        this.isManual = false;                // true if this step has the manual identifier (-M)
        this.isDebug = false;                 // true if this step has the debug identifier (~)
        this.isBeforeDebug = false;           // true if this step has the debug identifier (~) before the step text
        this.isAfterDebug = false;            // true if this step has the debug identifier (~) after the step text
        this.isOnly = false;                  // true if this step has the only identifier ($)
        this.isNonParallel = false;           // true if this step has the non-parallel identifier (+)
        this.isSequential = false;            // true if this step has the sequential identifier (..)
        this.isExpectedFail = false;          // true if this step has the expected fail indentifier (#)

        this.isHook = false;                  // true if this step is a hook
        this.isPackaged = false;              // true if this step is from a package file

        this.varsBeingSet = [];               // if this step is in the format {var1}=Step1, {{var2}}=Step2, etc., this array will contain objects {name: "var1", value: "Step1", isLocal: false}, {name: "var2", value: "Step2", isLocal: true} etc.

        this.containingStepBlock = {};        // the StepBlock that contains this Step

        this.originalStepInTree = {};         // when this step is cloned, the clone's originalStepInTree points to the Step from which it was cloned
        this.level = 0;               // number of function calls deep this step is within its branch

        this.isPassed = false;                // true if this step passed after being run
        this.isFailed = false;                // true if this step failed after being run
        this.isSkipped = false;               // true if this step was skipped
        this.isRunning = false;               // true if this step is currently running
        this.asExpected = false;              // true if the passed/failed state is as expected

        this.error = {};                      // if this step failed, this is the Error that was thrown
        this.log = [];                        // Array of objects that represent the logs of this step

        this.elapsed = 0;                     // number of ms it took this step to execute
        this.timeStarted = {};                // Date object (time) of when this step started being executed
        this.timeEnded = {};                  // Date object (time) of when this step ended execution

        htmlReport = "";                      // html that represents this step in reports
        */
    }

    /**
     * Generates a clone of this Step, ready to be placed into a Branch
     * Cannot be called if this is a StepBlock
     * @param {Boolean} [noRefs] - If true, the clone will contain no references to outside objects (such as originalStepInTree)
     * @return {Step} A distinct copy of this Step, but with parent, children, containingStepBlock, and functionDeclarationInTree deleted, and originalStepInTree set
     */
    cloneForBranch(noRefs) {
        // We don't want the clone to walk the tree into other Step objects, such as this.parent
        // Therefore, temporarily remove references to other Steps
        let originalParent = this.parent;
        delete this.parent;

        let originalChildren = this.children;
        delete this.children;

        let originalFunctionDeclarationInTree = this.functionDeclarationInTree;
        delete this.functionDeclarationInTree; // delete because this variable is optional and is undefined by default

        let originalContainingStepBlock = this.containingStepBlock;
        delete this.containingStepBlock; // delete because this variable is optional and is undefined by default

        let originalOriginalStepInTree = this.originalStepInTree;
        delete this.originalStepInTree;

        // Clone
        let clone = clonedeep(this);
        if(!noRefs) {
            clone.originalStepInTree = originalOriginalStepInTree ? originalOriginalStepInTree : this; // double-cloning a Step retains originalStepInTree pointing at the original step under this.root
        }

        // Restore originals
        this.parent = originalParent;
        this.children = originalChildren;
        originalFunctionDeclarationInTree && (this.functionDeclarationInTree = originalFunctionDeclarationInTree);
        originalContainingStepBlock && (this.containingStepBlock = originalContainingStepBlock);
        originalOriginalStepInTree && (this.originalStepInTree = originalOriginalStepInTree);

        return clone;
    }

    /**
     * @return {Array} Array of Step, which are the leaves of this step's underlying tree, [ this ] if this is itself a leaf
     */
    getLeaves() {
        if(this.children.length == 0) {
            // this is a leaf
            return [ this ];
        }
        else {
            let arr = [];
            this.children.forEach(child => {
                arr = arr.concat(child.getLeaves());
            });
            return arr;
        }
    }

    /**
     * Checks to see if this step, which is a function call, matches the given function declaration (case insensitive)
     * @param {Step} functionDeclaration - A function declaration step
     * @return {Boolean} true if they match, false if they don't
     * @throws {Error} if there's a case insensitive match but not a case sensitive match
     */
    isFunctionMatch(functionDeclaration) {
        let functionCallText = this.getFunctionCallText();
        let functionDeclarationText = functionDeclaration.text;

        // When hooking up functions, canonicalize by trim(), toLowerCase(), and replace \s+ with a single space
        // functionDeclarationText can have {{variables}}
        // functionCallText can have {{vars}}, {vars}, 'strings', "strings", and [strings]

        functionDeclarationText = functionDeclarationText
            .replace(Constants.VAR, '{}');
        functionDeclarationText = utils.unescape(functionDeclarationText);
        functionDeclarationText = utils.canonicalize(functionDeclarationText);

        functionCallText = functionCallText
            .replace(Constants.STRING_LITERAL, '{}')
            .replace(Constants.VAR, '{}');
        functionCallText = utils.unescape(functionCallText);
        functionCallText = utils.canonicalize(functionCallText);

        if(functionDeclarationText.endsWith('*')) {
            return functionCallText.startsWith(functionDeclarationText.replace(/\*$/, ''));
        }
        else {
            return functionCallText == functionDeclarationText;
        }
    }

    /**
     * @return {String} The text of the function call (without the leading {var}=, if one exists), null if step isn't a function call
     */
    getFunctionCallText() {
        if(this.isFunctionCall) {
            if(this.varsBeingSet && this.varsBeingSet.length == 1) { // {var} = Func
                return this.varsBeingSet[0].value;
            }
            else { // Func
                return this.text;
            }
        }
        else {
            return null;
        }
    }

    /**
     * Merges functionDeclarationInTree into this Step (identifier booleans are OR'ed in from functionDeclarationInTree into this)
     * If this.functionDeclarationInTree has a code block, it is copied into this
     * This step must be a function call
     * @param {Step} functionDeclarationInTree - The function declaration that corresponds to this step
     */
    mergeInFunctionDeclaration(functionDeclarationInTree) {
        this.functionDeclarationInTree = functionDeclarationInTree;
        this.functionDeclarationText = functionDeclarationInTree.text;

        let isToDo = this.isToDo || functionDeclarationInTree.isToDo;
        isToDo && (this.isToDo = isToDo);

        let isManual = this.isManual || functionDeclarationInTree.isManual;
        isManual && (this.isManual = isManual);

        let isDebug = this.isDebug || functionDeclarationInTree.isDebug;
        isDebug && (this.isDebug = isDebug);

        let isBeforeDebug = this.isBeforeDebug || functionDeclarationInTree.isBeforeDebug;
        isBeforeDebug && (this.isBeforeDebug = isBeforeDebug);

        let isAfterDebug = this.isAfterDebug || functionDeclarationInTree.isAfterDebug;
        isAfterDebug && (this.isAfterDebug = isAfterDebug);

        let isOnly = this.isOnly || functionDeclarationInTree.isOnly;
        isOnly && (this.isOnly = isOnly);

        let isNonParallel = this.isNonParallel || functionDeclarationInTree.isNonParallel;
        isNonParallel && (this.isNonParallel = isNonParallel);

        let isSequential = this.isSequential || functionDeclarationInTree.isSequential;
        isSequential && (this.isSequential = isSequential);

        let isExpectedFail = this.isExpectedFail || functionDeclarationInTree.isExpectedFail;
        isExpectedFail && (this.isExpectedFail = isExpectedFail);

        let isPackaged = this.isPackaged || functionDeclarationInTree.isPackaged;
        isPackaged && (this.isPackaged = isPackaged);

        let isHook = this.isHook || functionDeclarationInTree.isHook;
        isHook && (this.isHook = isHook);

        if(functionDeclarationInTree.hasCodeBlock()) {
            this.codeBlock = functionDeclarationInTree.codeBlock;
        }
    }

    /**
     * @return {Step} clone of this function declaration step (using this.cloneForBranch()), converted into a function call step
     */
    cloneAsFunctionCall() {
        let clone = this.cloneForBranch();
        clone.isFunctionDeclaration = false;
        clone.isFunctionCall = true;
        return clone;
    }

    /**
     * Logs the given item to this Step
     * @param {Object or String} item - The item to log
     */
    appendToLog(item) {
        if(!this.log) {
            this.log = [];
        }

        if(typeof item == 'string') {
            this.log.push( { text: item } );
        }
        else {
            this.log.push(item);
        }
    }

    /**
     * @return {Boolean} True if this Step completed already
     */
    isComplete() {
        return this.isPassed || this.isFailed || this.isSkipped;
    }

    /**
     * @return {Boolean} True if this step has a code block, false otherwise
     */
    hasCodeBlock() {
        return typeof this.codeBlock != 'undefined';
    }
}
module.exports = Step;
