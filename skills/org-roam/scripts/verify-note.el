;;; verify-note.el --- Lint org-roam notes for idiomatic structure -*- lexical-binding: t; -*-

;; Usage (single invocation, returns a report string):
;;   emacsclient --eval '(progn (load-file "<skill>/scripts/verify-note.el")
;;                              (org-note-verify "/abs/path/note.org"))'
;;
;; Exit status is not meaningful; read the returned report. Each note prints
;; either "OK" plus a structure summary, or a list of problems with line numbers.
;;
;; Checks, in order of severity:
;;   1. property drawer swallowing #+ keywords  (destroys the file node)
;;   2. file-level :ID: missing or unregistered in org-roam
;;   3. tags only in the :TAGS: property (does not populate node tags)
;;   4. emphasis spanning a line break
;;   5. nested emphasis markers
;;   6. emphasis markers inside #+CAPTION: (captions are literal text)
;;   7. internal [[#custom-id]] links that do not resolve
;;   8. [[id:uuid]] links that do not resolve in the org-roam database
;;   9. tool-output artifacts (status footers) written into the note
;;  10. flat prose: a long note with no headings

(require 'cl-lib)
(require 'org)
(require 'org-element)

(defvar org-note-verify-min-lines-for-headings 25
  "A note longer than this with no headings is reported as flat prose.")

(defun org-note--lines (buffer) (count-lines (point-min) (point-max)))

(defun org-note--file-id (buffer)
  "Return the file-level :ID: of BUFFER, or nil."
  (with-current-buffer buffer (org-entry-get (point-min) "ID")))

(defun org-note--roam-registered (id)
  "Non-nil when ID resolves to an org-roam node."
  (and id (fboundp 'org-roam-node-from-id)
       (condition-case nil (org-roam-node-from-id id) (error nil))))

(defun org-note--count (form id table)
  "Count rows in org-roam TABLE for node ID using query FORM."
  (condition-case nil
      (length (funcall form `[:select [,(if (eq table 'refs) 'ref 'alias)]
                               :from ,table :where (= node-id ,id)]))
    (error 0)))

(defun org-note--verify-one (file)
  "Return a report string for org-roam note FILE."
  (unless (file-exists-p file) (error "No such file: %s" file))
  (let ((buf (generate-new-buffer " *org-note-verify*")))
    (unwind-protect
        (with-current-buffer buf
          (insert-file-contents file)
          (org-mode)
          (let* ((tree (org-element-parse-buffer))
                 (problems '())
                 (emph (org-element-map tree '(bold italic underline strike-through verbatim code) #'identity))
                 (headlines (org-element-map tree 'headline #'identity))
                 (drawers (org-element-map tree 'property-drawer #'identity))
                 (id-headlines (cl-remove-if-not
                                (lambda (h) (org-element-property :ID h)) headlines))
                 (custom-ids (mapcar (lambda (h) (org-element-property :CUSTOM_ID h)) headlines))
                 (links (org-element-map tree 'link #'identity))
                 (keywords (org-element-map tree 'keyword #'identity))
                 (keys (mapcar (lambda (k) (upcase (or (org-element-property :key k) ""))) keywords))
                 (fid (org-note--file-id buf))
                 (nl (org-note--lines buf)))
            ;; 1. drawer swallowing keywords -- the critical one
            (dolist (d drawers)
              (when (string-match-p "#+"
                     (buffer-substring-no-properties
                      (org-element-property :begin d) (org-element-property :end d)))
                (push (format "line %d: property drawer contains #+ keywords -- move :END: above them or the file node is lost"
                              (line-number-at-pos (org-element-property :begin d)))
                      problems)))
            ;; 2. file-level ID
            (cond
             ((not fid)
              (push (if (string-prefix-p ":PROPERTIES:" (buffer-substring-no-properties (point-min) (min (point-max) 13)))
                        "no file-level :ID: -- the leading drawer is malformed; :END: must close it before any #+ keyword"
                      "no file-level :ID: in the leading property drawer")
                    problems))
             ((and (fboundp 'org-roam-node-from-id) (not (org-note--roam-registered fid)))
              (push (format "file :ID: %s does not resolve in org-roam (run org-roam-db-sync; if it still fails the header block is malformed)" fid)
                    problems)))
            ;; 3. tags
            (when (and (org-entry-get (point-min) "TAGS") (not (member "FILETAGS" keys)))
              (push "tags only in the :TAGS: property -- add #+FILETAGS:, which is what org-roam reads" problems))
            (unless (member "TITLE" keys)
              (push "no #+TITLE: keyword -- org-roam falls back to the filename" problems))
            ;; 4/5. emphasis defects
            (dolist (e emph)
              (let ((raw (buffer-substring-no-properties
                          (org-element-property :begin e) (org-element-property :end e))))
                (when (string-match-p "\n" raw)
                  (push (format "line %d: %s emphasis spans a line break -- keep both markers on one line"
                                (line-number-at-pos (org-element-property :begin e))
                                (org-element-type e))
                        problems))
                (when (and (memq (org-element-type e) '(bold italic))
                           (cl-remove-if (lambda (c) (eq c e))
                                         (org-element-map e '(verbatim code bold italic) #'identity)))
                  (push (format "line %d: nested emphasis markers -- use one marker, not both"
                                (line-number-at-pos (org-element-property :begin e)))
                        problems))))
            ;; 6. markers inside captions
            (dolist (k keywords)
              (when (and (string= (upcase (or (org-element-property :key k) "")) "CAPTION")
                         (string-match-p "\\(\*[^*
]+\*\\)\\|\\(/[^/
]+/\\)"
                                         (or (org-element-property :value k) "")))
                (push (format "line %d: emphasis markers inside #+CAPTION: render literally -- remove them"
                              (line-number-at-pos (org-element-property :begin k)))
                      problems)))
            ;; 7. internal custom-id links
            (dolist (l links)
              (when (string= (or (org-element-property :type l) "") "custom-id")
                (unless (member (org-element-property :path l) custom-ids)
                  (push (format "line %d: [[#%s]] has no matching :CUSTOM_ID: in this file"
                                (line-number-at-pos (org-element-property :begin l))
                                (org-element-property :path l))
                        problems))))
            ;; 8. id links
            (when (fboundp 'org-roam-node-from-id)
              (dolist (l links)
                (when (string= (or (org-element-property :type l) "") "id")
                  (unless (org-note--roam-registered (org-element-property :path l))
                    (push (format "line %d: [[id:%s]] does not resolve in org-roam"
                                  (line-number-at-pos (org-element-property :begin l))
                                  (org-element-property :path l))
                          problems)))))
            ;; 9. tool-output artifacts written into the note
            (dolist (artifact '("JSON clean" "<multi-line string, see section:" "chars) ---" "🟡"))
              (save-excursion
                (goto-char (point-min))
                (while (search-forward artifact nil t)
                  (push (format "line %d: tool-output artifact %S written into the note -- sanitize command output before interpolating it"
                                (line-number-at-pos (match-beginning 0)) artifact)
                        problems))))
            ;; 10. flat prose
            (when (and (> nl org-note-verify-min-lines-for-headings) (zerop (length headlines)))
              (push (format "%d lines with no headings -- split into * sections; add :ID: to the ones worth linking"
                            nl)
                    problems))
            ;; report
            (format "%s (%d lines): %s\n  structure: headings=%d outline-nodes=%d custom-ids=%d | emphasis=%d italic=%d bold=%d verbatim=%d | refs=%s aliases=%s\n%s"
                    (file-name-nondirectory file) nl
                    (if problems (format "%d PROBLEM(S)" (length problems)) "OK")
                    (length headlines) (length id-headlines)
                    (length (cl-remove-if #'null custom-ids))
                    (length emph)
                    (length (cl-remove-if-not (lambda (e) (eq (org-element-type e) 'italic)) emph))
                    (length (cl-remove-if-not (lambda (e) (eq (org-element-type e) 'bold)) emph))
                    (length (cl-remove-if-not (lambda (e) (memq (org-element-type e) '(verbatim code))) emph))
                    (if fid (number-to-string
                             (org-note--count #'org-roam-db-query fid 'refs)) "-")
                    (if fid (number-to-string
                             (org-note--count #'org-roam-db-query fid 'aliases)) "-")
                    (if problems (concat "  - " (mapconcat #'identity (nreverse problems) "\n  - ")) ""))))
      (kill-buffer buf))))

;;;###autoload
(defun org-note-verify (&rest files)
  "Report structural problems in each org-roam note in FILES."
  (if (null files) "usage: (org-note-verify \"/abs/path/note.org\" ...)"
    (mapconcat #'identity (mapcar #'org-note--verify-one files) "\n\n")))

(provide 'verify-note)
;;; verify-note.el ends here
