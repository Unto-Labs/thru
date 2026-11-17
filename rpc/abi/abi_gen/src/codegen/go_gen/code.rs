/* Statement builder for generated Go.

Go has no `?`: every fallible step is a statement that returns early. The
emitter writes those statements here and gets back the name of a temporary
holding the value, so expression code can still be composed bottom-up. */

#[derive(Clone)]
pub struct Code {
    pub s: String,
    ind: usize,
    tmp: usize,
    /* Return statement prefix used on error, e.g. `return nil, `. */
    fail: String,
}

impl Code {
    pub fn new(ind: usize, fail: &str) -> Self {
        Self {
            s: String::new(),
            ind,
            tmp: 0,
            fail: fail.to_string(),
        }
    }

    pub fn fail(&self) -> &str {
        &self.fail
    }

    pub fn l(&mut self, line: &str) {
        if line.is_empty() {
            self.s.push('\n');
            return;
        }
        for _ in 0..self.ind {
            self.s.push('\t');
        }
        self.s.push_str(line);
        self.s.push('\n');
    }

    /* A line ending in `{`; indents what follows. */
    pub fn open(&mut self, line: &str) {
        self.l(line);
        self.ind += 1;
    }

    pub fn close(&mut self) {
        self.ind -= 1;
        self.l("}");
    }

    /* A `case x:` / `default:` label of the enclosing `switch`. */
    pub fn case_(&mut self, line: &str) {
        self.ind -= 1;
        self.l(line);
        self.ind += 1;
    }

    /* `} else {` style continuation. */
    pub fn mid(&mut self, line: &str) {
        self.ind -= 1;
        self.l(line);
        self.ind += 1;
    }

    pub fn t(&mut self) -> String {
        self.tmp += 1;
        format!("t{}", self.tmp)
    }

    /* Return early with `err_expr`. */
    pub fn ret_err(&mut self, err_expr: &str) {
        let f = format!("{}{}", self.fail, err_expr);
        self.l(&f);
    }

    /* `if err != nil { return ..., <err_expr> }` */
    pub fn check(&mut self, err_expr: &str) {
        self.open("if err != nil {");
        self.ret_err(err_expr);
        self.close();
    }

    /* `call` returns (value, error): bind the value to a fresh temporary. */
    pub fn val(&mut self, call: &str) -> String {
        let t = self.t();
        self.l(&format!("{t}, err := {call}"));
        self.check("err");
        t
    }

    /* Like `val`, but a size error is re-expressed relative to `base`. */
    pub fn val_shift(&mut self, call: &str, base: &str) -> String {
        let t = self.t();
        self.l(&format!("{t}, err := {call}"));
        self.check(&format!("tnabi.Shifted(err, {base})"));
        t
    }

    /* `call` returns only an error. */
    pub fn unit(&mut self, call: &str) {
        self.open(&format!("if err := {call}; err != nil {{"));
        self.ret_err("err");
        self.close();
    }

    /* `call` returns (value, error); only the error matters. */
    pub fn unit_val(&mut self, call: &str) {
        self.open(&format!("if _, err := {call}; err != nil {{"));
        self.ret_err("err");
        self.close();
    }

    /* Close a function literal passed as an argument: `})`. */
    pub fn ind_close_paren(&mut self) {
        self.ind -= 1;
        self.l("})");
    }

    /* Return a sentinel error (`tnabi.ErrX`). */
    pub fn bail(&mut self, sentinel: &str) {
        self.ret_err(sentinel);
    }
}
